export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { readSheetAsText, sheetsServiceAccountEmail } from '@/lib/messages/sheetsClient'
import { parseSchedule } from '@/lib/messages/parseSchedule'

async function authUid(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function assertAdmin(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  if ((await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists) return true
  return (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
}

// GET → the SA email the owner must share their sheet with (for the UI).
export async function GET(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ email: sheetsServiceAccountEmail() })
}

// POST { pageId, sheetUrl } → read the shared sheet, parse dates, return entries.
export async function POST(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  const sheetUrl: string | undefined = body.sheetUrl
  if (!pageId || !sheetUrl) return NextResponse.json({ error: 'pageId and sheetUrl required' }, { status: 400 })
  if (!(await assertAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const text = await readSheetAsText(sheetUrl)
    const entries = parseSchedule(text)
    return NextResponse.json({ entries })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sheet sync failed' }, { status: 502 })
  }
}
