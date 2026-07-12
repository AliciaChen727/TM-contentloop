// IG follower demographics for ONE page (content dashboard card). Access:
// anyone entitled to this page — own OAuth connection, page admin, invited
// member/viewer, or super-admin. Data is written nightly by /api/cron/sync.
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

async function canAccessPage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const pages: { pageId?: string }[] = viewer.data()?.pages ?? []
  return pages.some((p) => p.pageId === pageId)
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canAccessPage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data() ?? {}
  return NextResponse.json({ igAudience: snap.igFollowerDemographics ?? null })
}
