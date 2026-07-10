/**
 * Single content draft — get / transition status / edit (Agent 自動發布 S1).
 * BFF: Bearer + admin-only (drafts are unpublished content). The state machine
 * (draftTypes.canTransition) is enforced in draftStore, so illegal moves 409.
 * See docs/agent-auto-publish-plan.md.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { getDraft, transitionDraft, editDraftContent, deleteDraft, scheduleDraft, unscheduleDraft, writeAudit } from '@/lib/content/draftStore'
import { HUMAN_DRIVEN_STATUSES, type DraftStatus, type GeneratedContent, type TaggingSelection } from '@/lib/content/draftTypes'
import { validateTaggingSelection } from '@/lib/tagging/server'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

async function canManage(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'content.draft')
}

async function canPublish(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'content.publish')
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

// DELETE /api/content-drafts/{id}?pageId= → permanently remove the draft.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canPublish(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ok = await deleteDraft(pageId, params.id)
  if (!ok) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
  await writeAudit(pageId, params.id, 'delete', uid)
  return NextResponse.json({ ok: true })
}

// PATCH /api/content-drafts/{id} { pageId, status?, generated? }
// - status: human-driven transitions only (approved/rejected/draft/expired).
// - generated: edit content (only while status=draft).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, status, generated, tagging, scheduleAt, unschedule } = (await req.json().catch(() => ({}))) as {
    pageId?: string; status?: DraftStatus; generated?: GeneratedContent; tagging?: TaggingSelection; scheduleAt?: number; unschedule?: boolean
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!status && !generated && tagging === undefined && scheduleAt === undefined && !unschedule) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  // Scheduling (approved → scheduled) / cancel (scheduled → approved).
  if (unschedule) {
    if (!(await canPublish(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const r = await unscheduleDraft(pageId, params.id)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    await writeAudit(pageId, params.id, 'unschedule', uid)
    return NextResponse.json({ draft: r.draft })
  }
  if (scheduleAt !== undefined) {
    if (!(await canPublish(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const r = await scheduleDraft(pageId, params.id, scheduleAt)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    await writeAudit(pageId, params.id, 'schedule', uid, { at: scheduleAt })
    return NextResponse.json({ draft: r.draft })
  }

  if (generated || tagging !== undefined) {
    if (tagging !== undefined) {
      const current = await getDraft(pageId, params.id)
      if (!current) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
      const tagCheck = await validateTaggingSelection(pageId, current.target, tagging)
      if (!tagCheck.ok) return NextResponse.json({ error: tagCheck.error }, { status: 422 })
    }
    const r = await editDraftContent(pageId, params.id, generated, tagging)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    await writeAudit(pageId, params.id, 'edit', uid)
    if (!status) return NextResponse.json({ draft: r.draft })
  }
  if (status) {
    // Publish-side states (publishing/processing/published/failed) belong to the
    // 发布流程, not the审核 UI — reject them here.
    if (!HUMAN_DRIVEN_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'that status is not human-settable' }, { status: 400 })
    }
    if ((status === 'approved' || status === 'rejected' || status === 'expired') && !(await canPublish(uid, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const r = await transitionDraft(pageId, params.id, status, uid)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
    await writeAudit(pageId, params.id, `status:${status}`, uid)
    return NextResponse.json({ draft: r.draft })
  }
  return NextResponse.json({ error: 'no-op' }, { status: 400 })
}
