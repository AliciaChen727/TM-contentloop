export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

// Reads FB Page stories (page-scoped). Mirrors /api/insights/ig/stories.
export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ stories: [] })

  // Resolve data owner: admin queries own data; viewer needs page admin's UID.
  let dataOwnerUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    const allowed = viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const ownerUid = await resolvePageOwnerUid(pageId)
    if (!ownerUid) return NextResponse.json({ stories: [] })
    dataOwnerUid = ownerUid
  }

  const snap = await adminDb
    .collection('users').doc(dataOwnerUid)
    .collection('pages').doc(pageId)
    .collection('fbStories')
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get()

  const stories = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate().toISOString() ?? null,
    syncedAt: doc.data().syncedAt?.toDate().toISOString() ?? null,
  }))

  return NextResponse.json({ stories })
}
