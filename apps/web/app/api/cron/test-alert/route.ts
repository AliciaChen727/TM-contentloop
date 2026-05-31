export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { processPageAlerts } from '@/lib/alerts/processAlerts'

// Temporary superadmin-only endpoint to test alert emails.
// DELETE this file after testing.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  if (!isSuperAdmin(uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { pageId } = await req.json() as { pageId: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  const result = await processPageAlerts(pageId)
  return NextResponse.json(result)
}
