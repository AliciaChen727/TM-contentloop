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

  const snap = await adminDb
    .collection('users')
    .doc(uid)
    .collection('igPosts')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get()

  const posts = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate().toISOString() ?? null,
    snapshotAt: doc.data().snapshotAt?.toDate().toISOString() ?? null,
  }))

  return NextResponse.json({ posts })
}
