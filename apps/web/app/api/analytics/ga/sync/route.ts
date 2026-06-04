/**
 * GA4 Sync / Read Route
 *
 * POST { pageId, since, until }  → fetch GA4 channel report, store snapshot, return it.
 * GET  ?pageId=...               → read the latest stored snapshot (for viewers / display).
 *
 * Auth: BFF — Bearer ID token + verifyIdToken. Access gated to the page's
 * admin / viewer / super-admin (same pattern as /api/insights/summary).
 *
 * Prereq to get real data (see docs/ga4-integration-poc.md):
 * 1. Enable Google Analytics Data API in GCP (contentloop-dev).
 * 2. pages/{pageId}.gaPropertyId set to the GA4 property id.
 * 3. SA (FIREBASE_ADMIN_CLIENT_EMAIL) granted Viewer on that GA4 property.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { runGaChannelReport } from '@/lib/analytics/gaClient'

async function authPage(req: NextRequest, pageId: string): Promise<{ uid: string } | NextResponse> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })

  const adminSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!adminSnap.exists) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    const allowed = viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { uid }
}

async function getPropertyId(pageId: string): Promise<string | null> {
  const pageDoc = await adminDb.collection('pages').doc(pageId).get()
  return (pageDoc.data()?.gaPropertyId as string | undefined) ?? null
}

const snapshotRef = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('gaInsights').doc('latest')

export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  const auth = await authPage(req, pageId)
  if (auth instanceof NextResponse) return auth

  const propertyId = await getPropertyId(pageId)
  if (!propertyId) return NextResponse.json({ configured: false, summary: null })

  const snap = await snapshotRef(pageId).get()
  return NextResponse.json({ configured: true, summary: snap.exists ? snap.data() : null })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const pageId: string = body.pageId ?? ''
  const auth = await authPage(req, pageId)
  if (auth instanceof NextResponse) return auth

  const propertyId = await getPropertyId(pageId)
  if (!propertyId) {
    return NextResponse.json(
      { error: 'GA4 未設定，請先在設定填入 GA4 Property ID（pages/{pageId}.gaPropertyId）', configured: false },
      { status: 400 },
    )
  }

  const since: string = body.since ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const until: string = body.until ?? new Date().toISOString().slice(0, 10)

  try {
    const summary = await runGaChannelReport(propertyId, since, until)
    await snapshotRef(pageId).set(summary)
    return NextResponse.json({ configured: true, summary })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'GA sync failed' },
      { status: 502 },
    )
  }
}
