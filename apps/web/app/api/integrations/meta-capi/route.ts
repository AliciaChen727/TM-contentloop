/**
 * Meta Conversions API config (per page, BFF, admin only). Stores the Pixel ID
 * and an encrypted access token, and can fire a test event to validate them.
 *
 * GET    ?pageId=                         → { configured, pixelId, enabled }
 * POST   { pageId, pixelId, accessToken } → save + send a test CompleteRegistration
 * DELETE { pageId }                       → disable / remove
 *
 * The access token is a sensitive secret: stored encrypted, never returned.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { encrypt } from '@/lib/encrypt'
import { sendCapiEvent, buildFbc } from '@/lib/meta/capi'

async function uidFrom(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function isAdmin(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  if ((await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists) return true
  return (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
}
const cfgRef = (pageId: string) => adminDb.collection('pages').doc(pageId).collection('integrations').doc('metaCapi')

export async function GET(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await isAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const d = (await cfgRef(pageId).get()).data()
  return NextResponse.json({ configured: !!(d?.pixelId && d?.accessTokenEnc), pixelId: d?.pixelId ?? '', enabled: d?.enabled !== false })
}

export async function POST(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { pageId?: string; pixelId?: string; accessToken?: string }
  const { pageId, pixelId, accessToken } = b
  if (!pageId || !pixelId || !accessToken) return NextResponse.json({ error: 'pageId, pixelId, accessToken required' }, { status: 400 })
  if (!(await isAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Validate by sending a test event before persisting.
  const test = await sendCapiEvent({
    pixelId: pixelId.trim(),
    accessToken: accessToken.trim(),
    eventName: 'CompleteRegistration',
    eventId: `test-${Date.now()}`,
    fbc: buildFbc('test'),
    eventSourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://tm-contentloop.vercel.app',
  })
  if (!test.ok) return NextResponse.json({ ok: false, error: test.error ?? 'Test event failed' }, { status: 400 })

  await cfgRef(pageId).set({
    pixelId: pixelId.trim(),
    accessTokenEnc: encrypt(accessToken.trim()),
    enabled: true,
    updatedBy: uid,
    updatedAt: new Date().toISOString(),
  }, { merge: true })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { pageId?: string }
  const pageId = b.pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await isAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await cfgRef(pageId).set({ enabled: false }, { merge: true })
  return NextResponse.json({ ok: true })
}
