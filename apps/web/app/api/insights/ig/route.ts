export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')

  // Resolve data owner: admin queries own data; viewer needs page admin's UID
  let dataOwnerUid = uid
  if (pageId) {
    const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
    if (!ownTokenSnap.exists) {
      const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
      const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
      if (!viewerPages.some(p => p.pageId === pageId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const adminsSnap = await adminDb.collection('pages').doc(pageId).collection('admins').limit(1).get()
      if (adminsSnap.empty) return NextResponse.json({ posts: [] })
      dataOwnerUid = adminsSnap.docs[0].id
    }
  }
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  const snap = pageId
    ? await userRef.collection('pages').doc(pageId).collection('igPosts').orderBy('timestamp', 'desc').limit(50).get()
    : await userRef.collection('igPosts').orderBy('timestamp', 'desc').limit(50).get()

  const posts = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate().toISOString() ?? null,
    snapshotAt: doc.data().snapshotAt?.toDate().toISOString() ?? null,
  }))

  return NextResponse.json({ posts })
}
