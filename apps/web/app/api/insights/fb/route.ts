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

  let rawDocs
  if (pageId) {
    const [newSnap, legacySnap] = await Promise.all([
      userRef.collection('pages').doc(pageId).collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get(),
      userRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get(),
    ])
    const seen = new Set<string>()
    rawDocs = [...newSnap.docs, ...legacySnap.docs]
      .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true })
      .sort((a, b) => (b.data().createdTime?.toMillis?.() ?? 0) - (a.data().createdTime?.toMillis?.() ?? 0))
      .slice(0, 200)
  } else {
    const snap = await userRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get()
    rawDocs = snap.docs
  }

  const posts = rawDocs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as { message?: string; [key: string]: unknown }),
      createdTime: doc.data().createdTime?.toDate().toISOString() ?? null,
      snapshotAt: doc.data().snapshotAt?.toDate().toISOString() ?? null,
    }))
    .filter((post) =>
      typeof post.message === 'string' &&
      post.message.trim().length > 0 &&
      !post.message.startsWith('這則貼文沒有文字')
    )

  return NextResponse.json({ posts })
}
