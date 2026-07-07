/**
 * Single content draft — get / transition status / edit (Agent 自動發布 S1).
 * BFF: Bearer + admin-only (drafts are unpublished content). The state machine
 * (draftTypes.canTransition) is enforced in draftStore, so illegal moves 409.
 * See docs/agent-auto-publish-plan.md.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getDraft, transitionDraft, editDraftContent } from '@/lib/content/draftStore'
import { HUMAN_DRIVEN_STATUSES, type DraftStatus, type GeneratedContent } from '@/lib/content/draftTypes'

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

// GET /api/content-drafts/{id}?pageId= → { draft }
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const draft = await getDraft(pageId, params.id)
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
  return NextResponse.json({ draft })
}

// PATCH /api/content-drafts/{id} { pageId, status?, generated? }
// - status: human-driven transitions only (approved/rejected/draft/expired).
// - generated: edit content (only while status=draft).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, status, generated } = (await req.json().catch(() => ({}))) as {
    pageId?: string; status?: DraftStatus; generated?: GeneratedContent
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!status && !generated) return NextResponse.json({ error: 'status or generated required' }, { status: 400 })

  if (generated) {
    const r = await editDraftContent(pageId, params.id, generated)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    if (!status) return NextResponse.json({ draft: r.draft })
  }
  if (status) {
    // Publish-side states (publishing/processing/published/failed) belong to the
    // 发布流程, not the审核 UI — reject them here.
    if (!HUMAN_DRIVEN_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'that status is not human-settable' }, { status: 400 })
    }
    const r = await transitionDraft(pageId, params.id, status, uid)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    return NextResponse.json({ draft: r.draft })
  }
  return NextResponse.json({ error: 'no-op' }, { status: 400 })
}
