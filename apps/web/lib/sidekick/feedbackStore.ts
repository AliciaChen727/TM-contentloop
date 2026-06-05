// Page-level feedback memory (Phase 3 self-learning). Stores the quality signal
// for each AI output — Sidekick reply or diagnosis card — so future prompts can
// retrieve proven examples. Shared per page (all admins benefit). See
// docs/phase-3-sidekick-self-learning.md §4 / §9.

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export type HumanAction = 'adopted' | 'edited' | 'rejected'

export interface FeedbackInput {
  source: 'sidekick' | 'diagnosis' | 'creative'
  goal?: string | null          // optimizationGoal
  // Creative (image-gen) intent signal: 'canva_import' (took into Canva) /
  // 'download'. Weaker than adopted — weighted by signalWeight in retrieval.
  signal?: string | null
  signalWeight?: number | null
  alertType?: string | null     // diagnosis: DiagItem.type；sidekick: contextPage
  context?: string | null       // ad/post data or conversation context
  output?: string | null        // the AI text
  evalScore?: number | null     // Quality evaluator total, 1–10 (behavior-aware)
  evalReasons?: string[] | null // per-dimension one-liners
  weakestDimension?: string | null
  recommendToFewShot?: boolean | null  // evalScore>=7 && humanAction='adopted'
  humanAction?: HumanAction | null
  reverted?: boolean | null     // was adopted then reopened/dismissed (regret signal)
  adoptedText?: string | null   // final text if adopted/edited (highest signal)
  metricsBefore?: { ctr: number; cpc: number; roas: number } | null  // account metrics at adoption (for 7-day delta)
  execBeforeFp?: string | null  // creative fingerprint at adoption (Slice E execution detection)
  // Specificity matching: the card's target creative (storyId) + its copy hash at
  // adoption → batch later checks whether THAT creative's copy changed.
  execTargetId?: string | null
  execTargetCopyHash?: string | null
  // Structured diagnosis fields (for few-shot block rendering, Slice C)
  diagTitle?: string | null
  diagDesc?: string | null
  cardTitle?: string | null
  cardWhy0?: string | null
  byUid?: string | null
  embedding?: number[] | null   // semantic vector (sidekick) for similarity retrieval
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
  if (input.signal !== undefined) payload.signal = input.signal ?? null
  if (input.signalWeight !== undefined) payload.signalWeight = input.signalWeight ?? null
  if (input.goal !== undefined) payload.goal = input.goal ?? null
  if (input.alertType !== undefined) payload.alertType = input.alertType ?? null
  if (input.context !== undefined) payload.context = (input.context ?? '').slice(0, 2000)
  if (input.output !== undefined) payload.output = (input.output ?? '').slice(0, 2000)
  if (input.evalScore !== undefined) payload.evalScore = typeof input.evalScore === 'number' ? input.evalScore : null
  if (input.evalReasons !== undefined) payload.evalReasons = input.evalReasons ?? null
  if (input.weakestDimension !== undefined) payload.weakestDimension = input.weakestDimension ?? null
  if (input.recommendToFewShot !== undefined) payload.recommendToFewShot = input.recommendToFewShot ?? null
  if (input.humanAction !== undefined) payload.humanAction = input.humanAction ?? null
  if (input.reverted !== undefined) payload.reverted = input.reverted ?? null
  // Stamp adoption time so the daily batch knows when the 7-day effect window opens.
  if (input.humanAction === 'adopted') payload.adoptedAt = FieldValue.serverTimestamp()
  if (input.metricsBefore !== undefined) payload.metricsBefore = input.metricsBefore ?? null
  if (input.execBeforeFp !== undefined) payload.execBeforeFp = input.execBeforeFp ?? null
  if (input.execTargetId !== undefined) payload.execTargetId = input.execTargetId ?? null
  if (input.execTargetCopyHash !== undefined) payload.execTargetCopyHash = input.execTargetCopyHash ?? null
  if (input.diagTitle !== undefined) payload.diagTitle = input.diagTitle ?? null
  if (input.diagDesc !== undefined) payload.diagDesc = input.diagDesc ?? null
  if (input.cardTitle !== undefined) payload.cardTitle = input.cardTitle ?? null
  if (input.cardWhy0 !== undefined) payload.cardWhy0 = input.cardWhy0 ?? null
  if (input.adoptedText !== undefined) payload.adoptedText = input.adoptedText ? input.adoptedText.slice(0, 2000) : null
  if (input.byUid !== undefined) payload.byUid = input.byUid ?? null
  if (input.embedding !== undefined) payload.embedding = input.embedding ?? null
  if (docId) {
    const ref = col.doc(docId)
    const exists = (await ref.get()).exists
    await ref.set(exists ? payload : { ...payload, createdAt: FieldValue.serverTimestamp() }, { merge: true })
    return docId
  }
  const ref = await col.add({ ...payload, createdAt: FieldValue.serverTimestamp() })
  return ref.id
}

// Patch the eval fields on an existing record (used by the daily batch re-score
// that runs after the human-action write). Only provided fields are written.
export interface EvalPatch {
  evalScore: number
  evalReasons: string[]
  weakestDimension?: string
  recommendToFewShot?: boolean
  adMetricsAfter?: Record<string, unknown> | null
}
export async function patchFeedbackEval(pageId: string, docId: string, patch: EvalPatch): Promise<void> {
  const p: Record<string, unknown> = {
    evalScore: patch.evalScore, evalReasons: patch.evalReasons, updatedAt: FieldValue.serverTimestamp(),
  }
  if (patch.weakestDimension !== undefined) p.weakestDimension = patch.weakestDimension
  if (patch.recommendToFewShot !== undefined) p.recommendToFewShot = patch.recommendToFewShot
  if (patch.adMetricsAfter !== undefined) p.adMetricsAfter = patch.adMetricsAfter
  await adminDb.collection('pages').doc(pageId).collection('sidekickFeedback').doc(docId)
    .set(p, { merge: true })
}
