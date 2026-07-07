/**
 * Throttled auto-sync coordinator. On page open the client asks to "claim" a
 * background sync; the claim only succeeds if data is stale (> STALE_HOURS since
 * last sync) AND no other sync is in progress (a short-lived lock). This keeps
 * the dashboard fast (reads pre-synced Firestore) while quietly fetching the
 * latest in the background — without hammering the Meta API on every load.
 * BFF: Bearer + admin-only (sync uses the admin's page token). Page-scoped.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

const STALE_MS = 3 * 60 * 60 * 1000     // resync only if > 3h since last sync
const LOCK_TTL_MS = 3 * 60 * 1000       // a claim's lock is valid for 3 min

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function canManage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return admin.exists
}

const metaRef = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('syncMeta').doc('content')

// POST { pageId, phase: 'claim' | 'done' }
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, phase } = (await req.json().catch(() => ({}))) as { pageId?: string; phase?: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = metaRef(pageId)

  if (phase === 'done') {
    // Sync finished (or manual sync) → record freshness + release the lock.
    await ref.set({ lastSyncedAt: Date.now(), lockAt: 0 }, { merge: true })
    return NextResponse.json({ ok: true })
  }

  // claim: atomically decide whether THIS caller should run the background sync.
  const result = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const d = snap.data() ?? {}
    const now = Date.now()
    const stale = now - (d.lastSyncedAt ?? 0) > STALE_MS
    const locked = now - (d.lockAt ?? 0) < LOCK_TTL_MS
    if (stale && !locked) { tx.set(ref, { lockAt: now }, { merge: true }); return { claim: true } }
    return { claim: false, stale, locked }
  })
  return NextResponse.json(result)
}
