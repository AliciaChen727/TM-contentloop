export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

type CardStatus = 'completed' | 'dismissed'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    return (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return null
  }
}

// Read access: owner / admin / viewer (any) / super-admin.
async function canRead(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const pages: { pageId: string }[] = viewer.data()?.pages ?? []
  return pages.some((p) => p.pageId === pageId)
}

// Write access: only owner / admin / super-admin (viewers cannot mark).
async function canManage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return admin.exists
}

const statusCol = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('diagnosisCardStatus')

// GET ?pageId= → { statuses: { [cardKey]: 'completed' | 'dismissed' } }
export async function GET(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canRead(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await statusCol(pageId).get()
  const statuses: Record<string, CardStatus> = {}
  for (const d of snap.docs) {
    const s = d.data()?.status
    if (s === 'completed' || s === 'dismissed') statuses[d.id] = s
  }
  return NextResponse.json({ statuses })
}

// POST { pageId, cardKey, status: 'completed' | 'dismissed' | 'open' }
// 'open' clears the status (reopen).
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, cardKey, status, severityRank } = (await req.json()) as {
    pageId?: string; cardKey?: string; status?: string; severityRank?: number
  }
  if (!pageId || !cardKey || !status) return NextResponse.json({ error: 'pageId, cardKey, status required' }, { status: 400 })
  if (!['completed', 'dismissed', 'open'].includes(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = statusCol(pageId).doc(cardKey)
  if (status === 'open') {
    await ref.delete()
  } else {
    // Record the severity at completion time so the cron can re-notify only when a
    // completed card later escalates (dismissed cards stay silent regardless).
    await ref.set({ status, byUid: uid, updatedAt: new Date().toISOString(), severityRank: severityRank ?? 0 })
  }
  return NextResponse.json({ ok: true, cardKey, status })
}
