export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { readSheetAsText, sheetsServiceAccountEmail } from '@/lib/messages/sheetsClient'
import { parseSchedule } from '@/lib/messages/parseSchedule'

async function authUid(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
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
  if (!(await can(uid, pageId, 'chatbot.manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const text = await readSheetAsText(sheetUrl)
    const entries = parseSchedule(text)
    return NextResponse.json({ entries })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sheet sync failed' }, { status: 502 })
  }
}
