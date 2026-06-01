// Page-level feedback memory (Phase 3 self-learning). Stores the quality signal
// for each AI output — Sidekick reply or diagnosis card — so future prompts can
// retrieve proven examples. Shared per page (all admins benefit). See
// docs/phase-3-sidekick-self-learning.md §4 / §9.

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export type HumanAction = 'adopted' | 'edited' | 'rejected'

export interface FeedbackInput {
  source: 'sidekick' | 'diagnosis'
  goal?: string | null          // optimizationGoal
  alertType?: string | null     // diagnosis: DiagItem.type；sidekick: contextPage
  context?: string | null       // ad/post data or conversation context
  output?: string | null        // the AI text
  evalScore?: number | null     // Quality evaluator overall (Slice 11)
  evalReasons?: string | null
  humanAction?: HumanAction | null
  adoptedText?: string | null   // final text if adopted/edited (highest signal)
  byUid?: string | null
}

// Write/merge a feedback record. When `docId` is given it upserts (preserves
// createdAt) — used for diagnosis cards keyed by cardKey so re-marking updates in
// place rather than spamming. Returns the doc id.
export async function writeFeedback(pageId: string, input: FeedbackInput, docId?: string): Promise<string> {
  const col = adminDb.collection('pages').doc(pageId).collection('sidekickFeedback')
  // Only write fields the caller actually provided, so a partial upsert (e.g. the
  // human-action write, which has no evalScore) never clobbers fields set by an
  // earlier write (e.g. the generation-time eval score). `undefined` = leave as-is.
  const payload: Record<string, unknown> = { source: input.source, updatedAt: FieldValue.serverTimestamp() }
  if (input.goal !== undefined) payload.goal = input.goal ?? null
  if (input.alertType !== undefined) payload.alertType = input.alertType ?? null
  if (input.context !== undefined) payload.context = (input.context ?? '').slice(0, 2000)
  if (input.output !== undefined) payload.output = (input.output ?? '').slice(0, 2000)
  if (input.evalScore !== undefined) payload.evalScore = typeof input.evalScore === 'number' ? input.evalScore : null
  if (input.evalReasons !== undefined) payload.evalReasons = input.evalReasons ?? null
  if (input.humanAction !== undefined) payload.humanAction = input.humanAction ?? null
  if (input.adoptedText !== undefined) payload.adoptedText = input.adoptedText ? input.adoptedText.slice(0, 2000) : null
  if (input.byUid !== undefined) payload.byUid = input.byUid ?? null
  if (docId) {
    const ref = col.doc(docId)
    const exists = (await ref.get()).exists
    await ref.set(exists ? payload : { ...payload, createdAt: FieldValue.serverTimestamp() }, { merge: true })
    return docId
  }
  const ref = await col.add({ ...payload, createdAt: FieldValue.serverTimestamp() })
  return ref.id
}

// Patch only the eval fields on an existing record (used by background scoring in
// Slice 11, which runs after the human-action write).
export async function patchFeedbackEval(pageId: string, docId: string, evalScore: number, evalReasons: string): Promise<void> {
  await adminDb.collection('pages').doc(pageId).collection('sidekickFeedback').doc(docId)
    .set({ evalScore, evalReasons, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
}
