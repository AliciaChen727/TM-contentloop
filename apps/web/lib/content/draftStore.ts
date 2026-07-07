// Server-side CRUD for content drafts (Agent 自動發布 S1). Page-scoped storage
// under pages/{pageId}/contentDrafts/{id} — access control lives in the API
// route (BFF), this layer is pure data ops. See docs/agent-auto-publish-plan.md.

import { randomUUID } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import {
  type ContentDraft, type CreateDraftInput, type DraftStatus,
  canTransition,
} from './draftTypes'

const col = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('contentDrafts')

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

export async function getDraft(pageId: string, id: string): Promise<ContentDraft | null> {
  const dd = await col(pageId).doc(id).get()
  return dd.exists ? fromDoc(pageId, id, dd.data() as FirebaseFirestore.DocumentData) : null
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
  if (current.status === to) return { ok: true, draft: current }
  if (!canTransition(current.status, to)) {
    return { ok: false, error: `illegal transition ${current.status} → ${to}`, code: 409 }
  }
  const patch: Record<string, unknown> = { status: to, updatedAt: Date.now() }
  if (to === 'approved') patch.approvedByUid = byUid
  if (to === 'draft') patch.approvedByUid = null   // 收回核准/重審 → 清核准者
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
