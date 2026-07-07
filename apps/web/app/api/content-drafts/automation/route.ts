/**
 * Per-page automation settings (Agent 自動發布 S5a) — Kill Switch + quiet hours
 * for the scheduled-publish cron. BFF: Bearer + admin-only.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getAutomationSettings, setAutomationSettings } from '@/lib/content/automationStore'

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

export async function GET(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ settings: await getAutomationSettings(pageId) })
}

// POST { pageId, killSwitch?, quietHours? }
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, killSwitch, quietHours } = (await req.json().catch(() => ({}))) as {
    pageId?: string; killSwitch?: boolean; quietHours?: { start: number; end: number } | null
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const patch: { killSwitch?: boolean; quietHours?: { start: number; end: number } | null } = {}
  if (typeof killSwitch === 'boolean') patch.killSwitch = killSwitch
  if (quietHours !== undefined) patch.quietHours = quietHours
  return NextResponse.json({ settings: await setAutomationSettings(pageId, patch, uid) })
}
