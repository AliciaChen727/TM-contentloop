export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

type Language = 'zh-TW' | 'en'

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const language: Language = snap.data()?.language ?? 'zh-TW'
  return NextResponse.json({ language })
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { language }: { language: Language } = await req.json()
  if (language !== 'zh-TW' && language !== 'en') {
    return NextResponse.json({ error: 'Invalid language' }, { status: 400 })
  }

  await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').set(
    { language, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  )

  return NextResponse.json({ success: true })
}
