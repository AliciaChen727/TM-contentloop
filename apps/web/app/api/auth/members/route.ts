export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { can, roleFromLegacyPerms } from '@/lib/auth/access'
import { type Role, isRole, legacyPermsForRole } from '@/lib/auth/roles'

interface LegacyPerms { ads: boolean; sidekick: boolean; syncAds: boolean }

/** 驗 token → 確認呼叫者對此頁有 members.manage 能力，回傳 uid，否則 null。 */
async function requireManager(idToken: string, pageId: string): Promise<string | null> {
  try {
    const uid = (await adminAuth.verifyIdToken(idToken)).uid
    return (await can(uid, pageId, 'members.manage')) ? uid : null
  } catch {
    return null
  }
}

function roleOf(data: FirebaseFirestore.DocumentData | undefined): Role {
  return isRole(data?.role) ? data!.role : roleFromLegacyPerms(data?.permissions as LegacyPerms)
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })

  const uid = await requireManager(idToken, pageId)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [adminsSnap, membersSnap, pendingSnap] = await Promise.all([
    adminDb.collection('pages').doc(pageId).collection('admins').get(),
    adminDb.collection('pages').doc(pageId).collection('members').get(),
    adminDb.collection('pages').doc(pageId).collection('pendingInvites').get(),
  ])

  // 頁名從 owner 解析（呼叫者可能是受邀 admin、名下沒有此頁 metaToken）。
  let pageName = ''
  const ownerUid = await resolvePageOwnerUid(pageId)
  if (ownerUid) {
    const ownerTok = await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
    pageName = ownerTok.data()?.pageName ?? ''
  }

  interface MemberOut {
    uid: string | null; email: string; displayName: string | null
    role: Role; source: 'oauth' | 'invite'; isOwner: boolean
    status: 'pending' | 'accepted'; addedAt: string | null
  }
  const byUid = new Map<string, MemberOut>()

  // OAuth 直接管理者（admins 子集合）— source oauth，角色不在此頁變更（owner 尤其）。
  await Promise.all(adminsSnap.docs.map(async d => {
    try {
      const user = await adminAuth.getUser(d.id)
      const isOwner = d.data().isOwner === true
      byUid.set(d.id, {
        uid: d.id, email: user.email ?? '', displayName: user.displayName ?? null,
        role: isOwner ? 'owner' : 'admin', source: 'oauth', isOwner,
        status: 'accepted', addedAt: d.data().addedAt?.toDate?.()?.toISOString() ?? null,
      })
    } catch { /* deleted auth user — skip */ }
  }))

  // 受邀成員（members 子集合）— source invite，可在此頁改角色。不含 OAuth 管理者本身。
  for (const d of membersSnap.docs) {
    if (byUid.has(d.id)) continue // 已在 admins（OAuth）→ 以 OAuth 為準
    if (d.id === uid) continue    // 不列自己
    const data = d.data()
    byUid.set(d.id, {
      uid: d.id, email: data.email ?? '', displayName: data.displayName ?? null,
      role: roleOf(data), source: 'invite', isOwner: false,
      status: 'accepted', addedAt: data.addedAt?.toDate?.()?.toISOString() ?? null,
    })
  }

  const pending: MemberOut[] = pendingSnap.docs.map(d => {
    const data = d.data()
    return {
      uid: null, email: data.email ?? d.id, displayName: null,
      role: roleOf(data), source: 'invite', isOwner: false,
      status: 'pending', addedAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    }
  })

  // owner 先、其餘 accepted、pending 最後
  const accepted = Array.from(byUid.values()).sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
  return NextResponse.json({ pageName, members: [...accepted, ...pending] })
}

export async function PATCH(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  const targetUid = req.nextUrl.searchParams.get('uid')     // accepted member
  const targetEmail = req.nextUrl.searchParams.get('email') // pending member
  if (!pageId || (!targetUid && !targetEmail)) return NextResponse.json({ error: 'Missing pageId and uid/email' }, { status: 400 })

  const managerUid = await requireManager(idToken, pageId)
  if (!managerUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  // 新模型：改角色。回溯相容：舊前端送 permissions 時映射成角色。
  const role: Role = isRole(body.role) ? body.role : roleFromLegacyPerms(body.permissions as LegacyPerms)
  if (role === 'owner') return NextResponse.json({ error: 'Owner 不可指派' }, { status: 400 })
  const permissions = legacyPermsForRole(role)

  if (targetUid) {
    // OAuth 管理者（含 owner）的角色不在此變更 — 他們在 admins 子集合。
    const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(targetUid).get()
    if (adminDoc.exists) return NextResponse.json({ error: 'OAuth 管理員角色不可在此變更' }, { status: 400 })

    await adminDb.collection('pages').doc(pageId).collection('members').doc(targetUid).set({ role, permissions }, { merge: true })
    const viewerRef = adminDb.collection('users').doc(targetUid).collection('viewerAccess').doc('pages')
    const viewerSnap = await viewerRef.get()
    if (viewerSnap.exists) {
      const pages: { pageId: string; role?: Role; permissions?: LegacyPerms }[] = viewerSnap.data()?.pages ?? []
      await viewerRef.update({ pages: pages.map(p => p.pageId === pageId ? { ...p, role, permissions } : p) })
    }
  } else if (targetEmail) {
    const email = targetEmail.toLowerCase()
    await adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(email).set({ role, permissions }, { merge: true })
    await adminDb.collection('invites').doc(email).collection('pages').doc(pageId).set({ role, permissions }, { merge: true })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  const targetUid = req.nextUrl.searchParams.get('uid')
  const targetEmail = req.nextUrl.searchParams.get('email')
  if (!pageId || (!targetUid && !targetEmail)) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const managerUid = await requireManager(idToken, pageId)
  if (!managerUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const batch = adminDb.batch()
  if (targetUid) {
    // Accepted member: remove from members + viewerAccess
    batch.delete(adminDb.collection('pages').doc(pageId).collection('members').doc(targetUid))
    const viewerRef = adminDb.collection('users').doc(targetUid).collection('viewerAccess').doc('pages')
    const viewerSnap = await viewerRef.get()
    if (viewerSnap.exists) {
      const pages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
      batch.update(viewerRef, { pages: pages.filter(p => p.pageId !== pageId) })
    }
  } else if (targetEmail) {
    // Pending member: remove from pendingInvites + invites
    const email = targetEmail.toLowerCase()
    batch.delete(adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(email))
    batch.delete(adminDb.collection('invites').doc(email).collection('pages').doc(pageId))
  }
  await batch.commit()

  return NextResponse.json({ success: true })
}
