export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

// POST /api/notifications/read  { id }  |  { all: true }
// Marks one (or all) of the caller's notifications as read.

async function authUid(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

export async function POST(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id, all } = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean }
  const col = adminDb.collection('users').doc(uid).collection('notifications')
  const patch = { read: true, readAt: FieldValue.serverTimestamp() }

  if (all === true) {
    const unread = await col.where('read', '==', false).limit(500).get()
    if (unread.empty) return NextResponse.json({ ok: true, updated: 0 })
    const batch = adminDb.batch()
    unread.docs.forEach((d) => batch.set(d.ref, patch, { merge: true }))
    await batch.commit()
    return NextResponse.json({ ok: true, updated: unread.size })
  }

  if (!id) return NextResponse.json({ error: 'id or all required' }, { status: 400 })
  await col.doc(id).set(patch, { merge: true })
  return NextResponse.json({ ok: true, updated: 1 })
}
