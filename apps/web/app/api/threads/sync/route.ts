/**
 * Threads sync — fetch the connected Threads account's posts + insights into
 * pages/{pageId}/threadsInsights/latest. BFF: Bearer + page access. Uses the
 * page's stored Threads token. Content only (no ads). Core in lib/threads/sync.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getThreadsToken } from '@/lib/threads/client'
import { syncThreadsForPage } from '@/lib/threads/sync'

async function canAccess(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  return ((viewer.data()?.pages ?? []) as { pageId: string }[]).some(p => p.pageId === pageId)
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId: string = (await req.json().catch(() => ({}))).pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await canAccess(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Caller's token first; fall back to the page owner's (viewer/super-admin).
  let tokenOwner = uid
  if (!(await getThreadsToken(uid, pageId))) {
    const owner = await resolvePageOwnerUid(pageId)
    if (owner && await getThreadsToken(owner, pageId)) tokenOwner = owner
  }

  const r = await syncThreadsForPage(tokenOwner, pageId)
  if (!r.ok) {
    if (r.error === 'not_connected') return NextResponse.json({ error: 'Threads 未連接，請先到設定連接 Threads', connected: false }, { status: 400 })
    return NextResponse.json({ error: r.error ?? 'threads sync failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, postCount: r.postCount })
}
