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

  const snap = await adminDb.collection('users').doc(uid).collection('adInsights').doc('latest').get()
  if (!snap.exists) return NextResponse.json({ data: null })

  const raw = snap.data()!
  // Convert Firestore Timestamp to ISO string for JSON serialization
  return NextResponse.json({
    data: {
      ...raw,
      syncedAt: raw.syncedAt?.toDate?.()?.toISOString() ?? null,
    },
  })
}
