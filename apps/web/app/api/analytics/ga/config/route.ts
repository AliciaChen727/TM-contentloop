/**
 * GA4 Config Route — self-service connection setup (Phase B).
 *
 * GET  ?pageId=...            → { propertyId, serviceAccountEmail } for the wizard.
 * POST { pageId, propertyId } → admin saves pages/{pageId}.gaPropertyId.
 *
 * BFF: Bearer ID token + verifyIdToken. POST is admin-only (the page owner /
 * advertiser themselves), so each advertiser can self-connect without the owner.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

const SA_EMAIL = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? ''

async function verify(req: NextRequest): Promise<string | NextResponse> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
}

async function isPageAdmin(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const snap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  return snap.exists
}

export async function GET(req: NextRequest) {
  const uid = await verify(req)
  if (uid instanceof NextResponse) return uid
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await isPageAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const pageDoc = await adminDb.collection('pages').doc(pageId).get()
  return NextResponse.json({
    propertyId: (pageDoc.data()?.gaPropertyId as string | undefined) ?? '',
    serviceAccountEmail: SA_EMAIL,
  })
}

export async function POST(req: NextRequest) {
  const uid = await verify(req)
  if (uid instanceof NextResponse) return uid
  const body = await req.json().catch(() => ({}))
  const pageId: string = body.pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await isPageAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Normalize: accept "properties/123" or "123"; empty string clears the link.
  const raw = String(body.propertyId ?? '').trim()
  const propertyId = raw.replace(/^properties\//, '').replace(/[^0-9]/g, '')
  if (raw && !propertyId) {
    return NextResponse.json({ error: 'Property ID 格式不正確（應為純數字，如 123456789）' }, { status: 400 })
  }

  await adminDb.collection('pages').doc(pageId).set({ gaPropertyId: propertyId || null }, { merge: true })
  return NextResponse.json({ ok: true, propertyId })
}
