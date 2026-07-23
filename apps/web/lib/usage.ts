import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const IMAGE_UNIT_COST_USD = 0.02   // Imagen 3 Fast
const VIDEO_PER_SECOND_USD = 0.50  // Veo 2

// Rough shared $/1M-token estimate — kept equal to the sidekick's original cost
// basis so claudeCostUsd stays consistent across every Claude call site. Per-model
// rates can be split out here later; `byModel` keeps the token breakdown regardless.
const CLAUDE_RATE = { inputPerM: 0.80, outputPerM: 4 }

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

// Global monthly Anthropic spend cap (USD). Protects the owner's total bill from a
// runaway autonomous agent. Tunable via env; 0/unset disables the cap.
const MONTHLY_CLAUDE_CAP_USD = Number(process.env.ANTHROPIC_MONTHLY_CAP_USD ?? 30)

// True when this month's TOTAL claudeCostUsd (summed across all users, same口徑 as
// /api/admin/usage) has hit the cap. Callers use this to downgrade the cron
// diagnosis agent from the sonnet tool loop to a single haiku call. Best-effort —
// any read failure returns false (never blocks diagnosis just because the check broke).
export async function isOverMonthlyClaudeCap(): Promise<boolean> {
  if (!(MONTHLY_CLAUDE_CAP_USD > 0)) return false
  try {
    const month = currentMonth()
    const snap = await adminDb.collectionGroup('usage').get()
    let total = 0
    for (const d of snap.docs) {
      if (d.id === month) total += (d.data()?.claudeCostUsd as number | undefined) ?? 0
    }
    return total >= MONTHLY_CLAUDE_CAP_USD
  } catch {
    return false
  }
}

// Shared Claude usage accounting. Writes to the SAME users/{uid}/usage/{month} doc
// the cost page + admin aggregate already read, so agent calls (diagnosis tool loop,
// sidekick, …) all land in one place instead of some paths being invisible. For a
// page-scoped agent, pass the page OWNER's uid (not pageId — the admin aggregate keys
// on users/{uid}). Best-effort — never throws, never blocks the caller.
export async function recordClaudeUsage(
  uid: string,
  usage: { model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  if (!uid || (usage.inputTokens <= 0 && usage.outputTokens <= 0)) return
  try {
    const costUsd = (usage.inputTokens * CLAUDE_RATE.inputPerM + usage.outputTokens * CLAUDE_RATE.outputPerM) / 1_000_000
    await adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).set({
      claudeInputTokens: FieldValue.increment(usage.inputTokens),
      claudeOutputTokens: FieldValue.increment(usage.outputTokens),
      claudeCostUsd: FieldValue.increment(costUsd),
      byModel: { [usage.model]: { inputTokens: FieldValue.increment(usage.inputTokens), outputTokens: FieldValue.increment(usage.outputTokens) } },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch (e) {
    console.error('[recordClaudeUsage] failed:', e instanceof Error ? e.message : e)
  }
}

export async function recordImageGeneration(uid: string): Promise<void> {
  try {
    await adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).set({
      imageCount: FieldValue.increment(1),
      imageCostUsd: FieldValue.increment(IMAGE_UNIT_COST_USD),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch {
    // non-critical: do not block response
  }
}

export async function recordVideoGeneration(uid: string, durationSeconds: number): Promise<void> {
  try {
    const cost = durationSeconds * VIDEO_PER_SECOND_USD
    await adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).set({
      videoCount: FieldValue.increment(1),
      videoSeconds: FieldValue.increment(durationSeconds),
      videoCostUsd: FieldValue.increment(cost),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch {
    // non-critical
  }
}
