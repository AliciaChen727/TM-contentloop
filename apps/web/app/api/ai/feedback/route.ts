export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { rating, response, pageContext, dataSnapshot, improveReason, improveNote } = await req.json() as {
    rating: 'helpful' | 'improve'
    response: string
    pageContext: string
    dataSnapshot?: object | null
    improveReason?: string
    improveNote?: string
  }

  if (!rating || !response) return NextResponse.json({ error: 'rating and response required' }, { status: 400 })

  const record: Record<string, unknown> = {
    rating,
    response: response.slice(0, 2000),
    pageContext: pageContext ?? '',
    dataSnapshot: dataSnapshot ?? null,
    createdAt: FieldValue.serverTimestamp(),
  }
  if (improveReason) record.improveReason = improveReason
  if (improveNote?.trim()) record.improveNote = improveNote.trim()

  await adminDb.collection('users').doc(uid).collection('sidekickFeedback').add(record)
  return NextResponse.json({ ok: true })
}
