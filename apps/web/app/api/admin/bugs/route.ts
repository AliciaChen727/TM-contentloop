// Super-admin only: recent AI bug reports (Slice 18 pipeline) for the admin
// dashboard. Read-only list; lifecycle actions happen on GitHub.
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  if (!isSuperAdmin(uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('bugReports').orderBy('createdAt', 'desc').limit(30).get()
  const bugs = snap.docs.map((d) => {
    const v = d.data()
    return {
      id: d.id,
      source: v.source ?? '',
      title: v.title ?? '',
      summary: v.summary ?? '',
      severity: v.severity ?? 'warning',
      status: v.status ?? 'open',
      count: v.count ?? 1,
      githubIssueUrl: v.githubIssueUrl ?? null,
      dateStr: v.dateStr ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createdAt: (v.createdAt as any)?.toDate?.()?.toISOString?.() ?? null,
    }
  })
  return NextResponse.json({ bugs })
}
