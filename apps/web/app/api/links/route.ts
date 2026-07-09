/**
 * Short-link management (BFF, page-scoped). Phase A = click tracking.
 *
 * GET    ?pageId=           → list links with click counts (viewer+)
 * POST   { pageId, destination, label?, postId? }  → create link (editor+)
 * DELETE { pageId, slug }   → deactivate link (editor+)
 *
 * ISOLATION (CLAUDE.md): every read/write is scoped to a pageId the caller is
 * verified to manage. The global `shortLinks/{slug}` doc only holds the minimal
 * data the public /r redirect needs (pageId + destination), nothing cross-page.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { genSlug, isValidDestination } from '@/lib/links/util'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tm-contentloop.vercel.app'

async function uidFrom(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function canManage(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'content.draft')
}
async function canRead(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'analytics.links')
}
const linksCol = (pageId: string) => adminDb.collection('pages').doc(pageId).collection('links')

export async function GET(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await canRead(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const manage = await canManage(uid, pageId)
  const snap = await linksCol(pageId).orderBy('createdAt', 'desc').get()
  const links = snap.docs.filter(d => d.data().active !== false).map(d => {
    const x = d.data()
    const track = x.trackConversion === true
    return {
      slug: d.id,
      shortUrl: `${APP_BASE}/r/${d.id}`,
      label: x.label ?? '',
      destination: x.destination ?? '',
      postId: x.source?.postId ?? null,
      clickCount: x.clickCount ?? 0,
      conversionCount: x.conversionCount ?? 0,
      deviceClicks: (x.deviceClicks ?? {}) as Record<string, number>,
      deviceConversions: (x.deviceConversions ?? {}) as Record<string, number>,
      value: x.value ?? 0,
      currency: x.currency ?? 'TWD',
      trackConversion: track,
      // Setup details only for editor+ (token is a shared secret).
      conversionUrl: track ? `${APP_BASE}/c/${d.id}` : null,
      webhookUrl: track && manage && x.conversionToken ? `${APP_BASE}/api/links/webhook/${d.id}?token=${x.conversionToken}` : null,
      paramName: track ? 'cl_id' : null,
      createdAt: x.createdAt ?? null,
    }
  })
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { pageId?: string; destination?: string; label?: string; postId?: string; trackConversion?: boolean; thankYouUrl?: string; value?: number; currency?: string }
  const { pageId, destination, label, postId, trackConversion, thankYouUrl, value, currency } = b
  if (!pageId || !destination) return NextResponse.json({ error: 'pageId, destination required' }, { status: 400 })
  if (!isValidDestination(destination)) return NextResponse.json({ error: 'Invalid destination URL' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Find a free slug (re-roll on the rare collision).
  let slug = ''
  for (let i = 0; i < 5; i++) {
    const candidate = genSlug()
    if (!(await adminDb.collection('shortLinks').doc(candidate).get()).exists) { slug = candidate; break }
  }
  if (!slug) return NextResponse.json({ error: 'Could not allocate slug' }, { status: 500 })

  const track = trackConversion === true
  const token = track ? randomUUID() : null
  const validThankYou = thankYouUrl && isValidDestination(thankYouUrl) ? thankYouUrl : null
  const now = new Date().toISOString()
  await Promise.all([
    adminDb.collection('shortLinks').doc(slug).set({
      pageId, destination, active: true, createdAt: now,
      trackConversion: track, thankYouUrl: validThankYou,
    }),
    linksCol(pageId).doc(slug).set({
      label: (label ?? '').slice(0, 80),
      destination,
      source: { postId: postId ?? null },
      value: Number.isFinite(value) && (value as number) > 0 ? value : 0,
      currency: (currency ?? 'TWD').slice(0, 6),
      clickCount: 0,
      conversionCount: 0,
      active: true,
      trackConversion: track,
      conversionToken: token,
      thankYouUrl: validThankYou,
      createdBy: uid,
      createdAt: now,
    }),
  ])
  return NextResponse.json({
    ok: true, slug,
    shortUrl: `${APP_BASE}/r/${slug}`,
    trackConversion: track,
    conversionUrl: track ? `${APP_BASE}/c/${slug}` : null,
    webhookUrl: track ? `${APP_BASE}/api/links/webhook/${slug}?token=${token}` : null,
    paramName: track ? 'cl_id' : null,
  })
}

export async function DELETE(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { pageId?: string; slug?: string }
  const { pageId, slug } = b
  if (!pageId || !slug) return NextResponse.json({ error: 'pageId, slug required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ISOLATION: confirm this slug actually belongs to the caller's page before
  // touching the global doc — never let one page deactivate another's link.
  const global = await adminDb.collection('shortLinks').doc(slug).get()
  if (global.exists && global.data()?.pageId !== pageId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await Promise.all([
    adminDb.collection('shortLinks').doc(slug).set({ active: false }, { merge: true }),
    linksCol(pageId).doc(slug).set({ active: false }, { merge: true }),
  ])
  return NextResponse.json({ ok: true })
}
