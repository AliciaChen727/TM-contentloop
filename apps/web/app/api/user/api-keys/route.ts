export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { encrypt, decrypt } from '@/lib/encrypt'

type KeyType = 'anthropic' | 'gemini'

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

// GET — return which keys are set (no key values)
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get()
  const data = snap.data() ?? {}
  return NextResponse.json({
    anthropic: !!data.anthropic,
    gemini: !!data.gemini,
  })
}

// POST — save encrypted key
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, key }: { type: KeyType; key: string } = await req.json()
  if (!type || !key?.trim()) return NextResponse.json({ error: 'Missing type or key' }, { status: 400 })
  if (type !== 'anthropic' && type !== 'gemini') return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  // Basic format check
  if (type === 'anthropic' && !key.startsWith('sk-ant-')) {
    return NextResponse.json({ error: 'Claude API key 格式不正確（應以 sk-ant- 開頭）' }, { status: 400 })
  }

  let encrypted: string
  try {
    encrypted = encrypt(key.trim())
  } catch {
    return NextResponse.json({ error: '加密失敗，請確認伺服器設定' }, { status: 500 })
  }

  await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').set(
    { [type]: encrypted, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  )

  return NextResponse.json({ success: true })
}

// DELETE — remove a key
export async function DELETE(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = req.nextUrl.searchParams.get('type') as KeyType | null
  if (type !== 'anthropic' && type !== 'gemini') return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').set(
    { [type]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  )

  return NextResponse.json({ success: true })
}

// Helper exported for API routes to retrieve and decrypt a user's key
export async function getUserApiKey(uid: string, type: KeyType): Promise<string | null> {
  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get()
  const encrypted = snap.data()?.[type]
  if (!encrypted) return null
  try {
    return decrypt(encrypted)
  } catch {
    return null
  }
}
