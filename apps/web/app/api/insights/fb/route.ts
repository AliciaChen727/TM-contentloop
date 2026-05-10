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
  const userRef = adminDb.collection('users').doc(uid)

  const snap = pageId
    ? await userRef.collection('pages').doc(pageId).collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get()
    : await userRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get()

  const posts = snap.docs
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
