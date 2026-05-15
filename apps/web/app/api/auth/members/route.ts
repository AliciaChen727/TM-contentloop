export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

interface Permissions { ads: boolean; sidekick: boolean; syncAds: boolean }

async function verifyAdmin(idToken: string, pageId: string): Promise<string | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    const uid = decoded.uid
    const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
    const adminPageIds = new Set(
      tokensSnap.docs.filter(d => d.id !== 'userToken').map(d => d.id === 'page' ? d.data().pageId : d.id).filter(Boolean)
    )
    return adminPageIds.has(pageId) ? uid : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })

  const decoded = await adminAuth.verifyIdToken(idToken).catch(() => null)
  const uid = decoded ? await verifyAdmin(idToken, pageId) : null
  if (!uid || !decoded) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [membersSnap, pendingSnap, tokensSnap] = await Promise.all([
    adminDb.collection('pages').doc(pageId).collection('members').get(),
    adminDb.collection('pages').doc(pageId).collection('pendingInvites').get(),
    adminDb.collection('users').doc(decoded.uid).collection('metaTokens').get(),
  ])

  const pageDoc = tokensSnap.docs.find(d => d.id === pageId) ?? tokensSnap.docs.find(d => d.id === 'page')
  const pageName: string = pageDoc?.data()?.pageName ?? ''

  const accepted = membersSnap.docs
    .filter(d => d.id !== uid)
    .map(d => {
      const data = d.data()
      return {
        uid: d.id,
        email: data.email ?? '',
        displayName: data.displayName ?? null,
        permissions: data.permissions ?? { ads: false, sidekick: false, syncAds: false },
        status: 'accepted' as const,
        addedAt: data.addedAt?.toDate?.()?.toISOString() ?? null,
      }
    })

  const pending = pendingSnap.docs.map(d => {
    const data = d.data()
    return {
      uid: null,
      email: d.id,
      displayName: null,
      permissions: data.permissions ?? { ads: false, sidekick: false, syncAds: false },
      status: 'pending' as const,
      addedAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    }
  })

  return NextResponse.json({ pageName, members: [...pending, ...accepted] })
}

export async function PATCH(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  const targetUid = req.nextUrl.searchParams.get('uid')  // null for pending members
  const targetEmail = req.nextUrl.searchParams.get('email')
  if (!pageId || (!targetUid && !targetEmail)) return NextResponse.json({ error: 'Missing pageId and uid/email' }, { status: 400 })

  const adminUid = await verifyAdmin(idToken, pageId)
  if (!adminUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { permissions }: { permissions: Permissions } = await req.json()

  if (targetUid) {
    // Accepted member: update members doc + viewerAccess
    await adminDb.collection('pages').doc(pageId).collection('members').doc(targetUid).update({ permissions })
    const viewerRef = adminDb.collection('users').doc(targetUid).collection('viewerAccess').doc('pages')
    const viewerSnap = await viewerRef.get()
    if (viewerSnap.exists) {
      const pages: { pageId: string; permissions?: Permissions }[] = viewerSnap.data()?.pages ?? []
      await viewerRef.update({ pages: pages.map(p => p.pageId === pageId ? { ...p, permissions } : p) })
    }
  } else if (targetEmail) {
    // Pending member: update pendingInvites + invite doc
    const email = targetEmail.toLowerCase()
    await adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(email).update({ permissions })
    await adminDb.collection('invites').doc(email).collection('pages').doc(pageId).update({ permissions })
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

  const adminUid = await verifyAdmin(idToken, pageId)
  if (!adminUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
