// Server-side CRUD for content drafts (Agent 自動發布 S1). Page-scoped storage
// under pages/{pageId}/contentDrafts/{id} — access control lives in the API
// route (BFF), this layer is pure data ops. See docs/agent-auto-publish-plan.md.

import { randomUUID } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type ContentDraft, type CreateDraftInput, type DraftStatus, type DraftTarget,
  canTransition,
} from './draftTypes'

const col = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('contentDrafts')

function hasErrorOnlyPublishResult(draft: ContentDraft): boolean {
  return Object.values(draft.publishResults ?? {}).some(r => r?.error && !r.postId)
}

// Append-only audit trail of who did what to a draft (approve/reject/edit…).
// Best-effort — never blocks the primary action.
export async function writeAudit(
  pageId: string, draftId: string, action: string, byUid: string, detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection('pages').doc(pageId).collection('publishAuditLog').add({
      draftId, action, byUid, at: Date.now(), ...(detail ?? {}),
    })
  } catch { /* audit is best-effort */ }
}

// Firestore doc → ContentDraft (id from doc id, pageId is implicit in path).
function fromDoc(pageId: string, id: string, d: FirebaseFirestore.DocumentData): ContentDraft {
  return {
    id,
    pageId,
    target: d.target ?? [],
    mediaType: d.mediaType ?? 'text',
    generated: d.generated ?? { perPlatform: {} },
    schedule: d.schedule ?? undefined,
    status: (d.status ?? 'draft') as DraftStatus,
    createdByUid: d.createdByUid ?? '',
    approvedByUid: d.approvedByUid ?? null,
    publishResult: d.publishResult ?? null,
    publishResults: d.publishResults ?? undefined,
    idempotencyKey: d.idempotencyKey ?? id,
    createdAt: d.createdAt ?? 0,
    updatedAt: d.updatedAt ?? 0,
  }
}

export async function createDraft(input: CreateDraftInput, byUid: string): Promise<ContentDraft> {
  const now = Date.now()
  const ref = col(input.pageId).doc()
  const draft: ContentDraft = {
    id: ref.id,
    pageId: input.pageId,
    target: input.target,
    mediaType: input.mediaType,
    generated: input.generated,
    schedule: input.schedule,
    status: 'draft',
    createdByUid: byUid,
    approvedByUid: null,
    publishResult: null,
    idempotencyKey: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  // Strip undefined (Firestore rejects it) — schedule may be absent.
  const doc: Record<string, unknown> = { ...draft }
  if (draft.schedule === undefined) delete doc.schedule
  await ref.set(doc)
  return draft
}

export async function listDrafts(pageId: string, opts?: { status?: DraftStatus; limit?: number }): Promise<ContentDraft[]> {
  let q: FirebaseFirestore.Query = col(pageId).orderBy('createdAt', 'desc')
  if (opts?.status) q = q.where('status', '==', opts.status)
  if (opts?.limit) q = q.limit(opts.limit)
  const snap = await q.get()
  return snap.docs.map(dd => fromDoc(pageId, dd.id, dd.data()))
}

// Status-only query (no orderBy → no composite index). Used by the cron.
export async function listByStatus(pageId: string, status: DraftStatus): Promise<ContentDraft[]> {
  const snap = await col(pageId).where('status', '==', status).get()
  return snap.docs.map(dd => fromDoc(pageId, dd.id, dd.data()))
}

export async function getDraft(pageId: string, id: string): Promise<ContentDraft | null> {
  const dd = await col(pageId).doc(id).get()
  return dd.exists ? fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData) : null
}

export async function deleteDraft(pageId: string, id: string): Promise<boolean> {
  const ref = col(pageId).doc(id)
  if (!(await ref.get()).exists) return false
  await ref.delete()
  return true
}

// Move a draft to a new status, enforcing the state machine. Returns the updated
// draft, or an error string if the transition is illegal / draft missing.
export async function transitionDraft(
  pageId: string, id: string, to: DraftStatus, byUid: string,
): Promise<{ ok: true; draft: ContentDraft } | { ok: false; error: string; code: number }> {
  const ref = col(pageId).doc(id)
  const dd = await ref.get()
  if (!dd.exists) return { ok: false, error: 'draft not found', code: 404 }
  const current = fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData)
  const retryApproved = current.status === 'approved' && to === 'approved' && hasErrorOnlyPublishResult(current)
  if (current.status === to && !retryApproved) return { ok: true, draft: current }
  if (!retryApproved && !canTransition(current.status, to)) {
    return { ok: false, error: `illegal transition ${current.status} → ${to}`, code: 409 }
  }
  // A published post can't be unpublished → block reverting to draft (Option A).
  if (to === 'draft' && current.target.some(t => current.publishResults?.[t]?.postId)) {
    return { ok: false, error: '已發布的內容無法收回，請改用「複製為新草稿」', code: 409 }
  }
  const patch: Record<string, unknown> = { status: to, updatedAt: Date.now() }
  if (to === 'approved') patch.approvedByUid = byUid
  if (to === 'draft' || (to === 'approved' && (current.status === 'failed' || retryApproved))) {
    if (to === 'draft') patch.approvedByUid = null   // 收回核准/重審 → 清核准者
    // Clear failed publish results (error-only entries) so stale errors don't show in UI.
    // Keep entries that have a postId (partial publishes that actually succeeded).
    const cleaned: Record<string, unknown> = {}
    for (const [plat, r] of Object.entries(current.publishResults ?? {})) {
      if ((r as { postId?: string }).postId) cleaned[plat] = r
    }
    if (Object.keys(cleaned).length !== Object.keys(current.publishResults ?? {}).length) {
      patch.publishResults = Object.keys(cleaned).length ? cleaned : FieldValue.delete()
    }
  }
  await ref.set(patch, { merge: true })
  return { ok: true, draft: { ...current, ...patch } as ContentDraft }
}

// Record a single platform's publish outcome. When every targeted platform has
// a successful postId, the whole draft flips to `published`; otherwise status is
// left as-is (partially published — user can publish the rest later).
export async function recordPublishOutcome(
  pageId: string, id: string, platform: DraftTarget,
  result: { postId?: string; permalink?: string; storyId?: string; error?: string },
): Promise<{ ok: true; draft: ContentDraft } | { ok: false; error: string; code: number }> {
  const ref = col(pageId).doc(id)
  const dd = await ref.get()
  if (!dd.exists) return { ok: false, error: 'draft not found', code: 404 }
  const current = fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData)
  const results = { ...(current.publishResults ?? {}), [platform]: { ...result, at: Date.now() } }
  const allDone = current.target.every(t => results[t]?.postId)
  const anyDone = current.target.some(t => results[t]?.postId)
  const patch: Record<string, unknown> = { publishResults: results, updatedAt: Date.now() }
  if (allDone) patch.status = 'published'
  else if (result.error && !anyDone) patch.status = 'failed'
  await ref.set(patch, { merge: true })
  return { ok: true, draft: { ...current, ...patch, publishResults: results } as ContentDraft }
}

// Schedule an approved draft for auto-publish at `at` (epoch ms). approved→scheduled.
export async function scheduleDraft(
  pageId: string, id: string, at: number,
): Promise<{ ok: true; draft: ContentDraft } | { ok: false; error: string; code: number }> {
  const ref = col(pageId).doc(id)
  const dd = await ref.get()
  if (!dd.exists) return { ok: false, error: 'draft not found', code: 404 }
  const current = fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData)
  if (!canTransition(current.status, 'scheduled')) return { ok: false, error: `cannot schedule from ${current.status}`, code: 409 }
  if (!Number.isFinite(at) || at <= Date.now()) return { ok: false, error: '排程時間需為未來時間', code: 400 }
  const patch = { status: 'scheduled' as DraftStatus, schedule: { mode: 'scheduled', at }, updatedAt: Date.now() }
  await ref.set(patch, { merge: true })
  return { ok: true, draft: { ...current, ...patch } as ContentDraft }
}

// Cancel a schedule → back to approved (ready for manual publish).
export async function unscheduleDraft(
  pageId: string, id: string,
): Promise<{ ok: true; draft: ContentDraft } | { ok: false; error: string; code: number }> {
  const ref = col(pageId).doc(id)
  const dd = await ref.get()
  if (!dd.exists) return { ok: false, error: 'draft not found', code: 404 }
  const current = fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData)
  if (current.status !== 'scheduled') return { ok: false, error: 'not scheduled', code: 409 }
  const patch = { status: 'approved' as DraftStatus, schedule: { mode: 'now' as const }, updatedAt: Date.now() }
  await ref.set(patch, { merge: true })
  return { ok: true, draft: { ...current, ...patch } as ContentDraft }
}

export async function editDraftContent(
  pageId: string, id: string, generated: ContentDraft['generated'],
): Promise<{ ok: true; draft: ContentDraft } | { ok: false; error: string; code: number }> {
  const ref = col(pageId).doc(id)
  const dd = await ref.get()
  if (!dd.exists) return { ok: false, error: 'draft not found', code: 404 }
  const current = fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData)
  // Only editable while still a draft — approved/published content is frozen.
  if (current.status !== 'draft') return { ok: false, error: 'only draft-status content is editable', code: 409 }
  const patch = { generated, updatedAt: Date.now() }
  await ref.set(patch, { merge: true })
  return { ok: true, draft: { ...current, ...patch } }
}
