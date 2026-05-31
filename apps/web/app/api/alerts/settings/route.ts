export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

const VALID_FREQ = ['daily', 'weekly', 'off']

async function authPage(req: NextRequest, pageId: string): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
  if (isSuperAdmin(uid)) return uid
  const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return adminDoc.exists ? uid : null
}

// GET /api/alerts/settings?pageId=xxx
export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const uid = await authPage(req, pageId)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const data = (await adminDb.collection('pages').doc(pageId).get()).data() ?? {}
  // Migrate legacy single alertEmail → alertEmails array
  const legacyEmail: string = data.alertEmail ?? ''
  const alertEmails: string[] = data.alertEmails ?? (legacyEmail ? [legacyEmail] : [])
  return NextResponse.json({
    alertFrequency: data.alertFrequency ?? 'off',
    alertEmails,
  })
}

// POST /api/alerts/settings  { pageId, alertFrequency, alertEmails? }
export async function POST(req: NextRequest) {
  const { pageId, alertFrequency, alertEmails } = await req.json() as {
    pageId: string; alertFrequency: string; alertEmails?: string[]
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const uid = await authPage(req, pageId)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!VALID_FREQ.includes(alertFrequency)) return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { alertFrequency }
  if (alertEmails !== undefined) {
    update.alertEmails = alertEmails.map(e => e.trim()).filter(Boolean)
  }

  await adminDb.collection('pages').doc(pageId).set(update, { merge: true })
  return NextResponse.json({ ok: true })
}
