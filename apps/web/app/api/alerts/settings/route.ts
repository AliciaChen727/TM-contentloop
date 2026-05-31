export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

// Derive new-style schedule from a page profile, migrating legacy alertFrequency.
function deriveSchedule(data: Record<string, unknown>) {
  if (typeof data.alertEnabled === 'boolean') {
    return {
      alertEnabled: data.alertEnabled,
      alertDays: Array.isArray(data.alertDays) ? data.alertDays as number[] : [0, 1, 2, 3, 4, 5, 6],
      alertHour: typeof data.alertHour === 'number' ? data.alertHour as number : 9,
    }
  }
  const freq = (data.alertFrequency ?? 'off') as string
  if (freq === 'off') return { alertEnabled: false, alertDays: [1, 2, 3, 4, 5], alertHour: 9 }
  if (freq === 'weekly') return { alertEnabled: true, alertDays: [1], alertHour: 9 }
  return { alertEnabled: true, alertDays: [0, 1, 2, 3, 4, 5, 6], alertHour: 9 }
}

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
    ...deriveSchedule(data),
    alertEmails,
  })
}

// POST /api/alerts/settings  { pageId, alertEnabled, alertDays, alertHour, alertEmails? }
export async function POST(req: NextRequest) {
  const { pageId, alertEnabled, alertDays, alertHour, alertEmails } = await req.json() as {
    pageId: string; alertEnabled?: boolean; alertDays?: number[]; alertHour?: number; alertEmails?: string[]
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const uid = await authPage(req, pageId)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {}
  if (alertEnabled !== undefined) update.alertEnabled = !!alertEnabled
  if (alertDays !== undefined) {
    update.alertDays = Array.from(new Set(alertDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
  }
  if (alertHour !== undefined) {
    if (!Number.isInteger(alertHour) || alertHour < 0 || alertHour > 23) {
      return NextResponse.json({ error: 'Invalid hour' }, { status: 400 })
    }
    update.alertHour = alertHour
  }
  if (alertEmails !== undefined) {
    update.alertEmails = alertEmails.map(e => e.trim()).filter(Boolean)
  }
  // Record who configured this so the "empty = my login email" fallback in
  // processAlerts resolves to THIS admin, not the page owner.
  update.alertConfiguredByUid = uid

  await adminDb.collection('pages').doc(pageId).set(update, { merge: true })
  return NextResponse.json({ ok: true })
}
