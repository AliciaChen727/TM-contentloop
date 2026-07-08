export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { roleFromLegacyPerms } from '@/lib/auth/access'
import { type Role, isRole, legacyPermsForRole } from '@/lib/auth/roles'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  let email: string
  let displayName: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
    email = decoded.email ?? ''
    displayName = decoded.name ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  if (!email) return NextResponse.json({ hasInvites: false })

  const pendingSnap = await adminDb
    .collection('invites')
    .doc(email.toLowerCase())
    .collection('pages')
    .where('status', '==', 'pending')
    .get()

  if (pendingSnap.empty) return NextResponse.json({ hasInvites: false })

  interface ViewerPage { pageId: string; pageName: string; igUserId: string | null; role: Role; permissions: { ads: boolean; sidekick: boolean; syncAds: boolean } }
  const batch = adminDb.batch()
  const viewerPages: ViewerPage[] = []

  for (const inviteDoc of pendingSnap.docs) {
    const data = inviteDoc.data()
    const pageId = inviteDoc.id
    // 角色為權威來源；舊邀請只有 permissions 時映射成角色。permissions 保留餵舊消費端。
    const role: Role = isRole(data.role) ? data.role : roleFromLegacyPerms(data.permissions)
    const permissions = legacyPermsForRole(role)
    batch.update(inviteDoc.ref, { status: 'accepted', acceptedAt: new Date(), acceptedBy: uid })
    batch.set(
      adminDb.collection('pages').doc(pageId).collection('members').doc(uid),
      { role, email, displayName, permissions, addedAt: new Date() }
    )
    // Remove from pendingInvites
    batch.delete(adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(email.toLowerCase()))
    viewerPages.push({ pageId, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null, role, permissions })
  }

  const viewerAccessRef = adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages')
  const existingSnap = await viewerAccessRef.get()
  const existing: ViewerPage[] = existingSnap.exists ? (existingSnap.data()?.pages ?? []) : []
  const merged = [...existing]
  for (const vp of viewerPages) {
    if (!merged.find(p => p.pageId === vp.pageId)) merged.push(vp)
  }
  batch.set(viewerAccessRef, { pages: merged })

  await batch.commit()

  return NextResponse.json({ hasInvites: true })
}
