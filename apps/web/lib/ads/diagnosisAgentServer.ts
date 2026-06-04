// Server-only side of the diagnosis Agent: the Haiku call + the fingerprint cache
// on pages/{pageId}/adInsights/latest. Shared by app/api/ai/diagnosis/route.ts
// (page) and lib/alerts/processAlerts.ts (cron → email/bell), so both produce and
// reuse the SAME cards. Pure helpers stay in diagnosisAgent.ts.

import Anthropic from '@anthropic-ai/sdk'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { DiagItem, AiDiagCard } from '@/components/ads/types'
import {
  computeDiagFingerprint, selectItemsForAgent, agentSystemPrompt, agentUserMessage, parseAndEnforceCards,
} from '@/lib/ads/diagnosisAgent'
import { getFewShotExamples, formatFewShot } from '@/lib/sidekick/feedbackRetrieval'
import { evaluateOutput } from '@/lib/sidekick/evaluator'
import { writeFeedback } from '@/lib/sidekick/feedbackStore'
import { diagnosisCardKey } from '@/lib/ads/diagnosisCardKey'

export interface EvalKeys { geminiKey?: string | null; anthropicKey?: string | null }

// Quality-evaluate a card set (LLM-as-judge), retry generation once when below
// threshold (reasons fed back), then persist evalScore per card into feedback
// memory (docId diag__cardKey — same doc the human action later merges into).
async function evaluateAndStore(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string,
  fewShot: string, cards: AiDiagCard[], evalKeys: EvalKeys,
): Promise<AiDiagCard[]> {
  const combine = (cs: AiDiagCard[]) => cs.map(c => `【${c.title}】${c.why.join(' ')} ${c.impact}`.trim()).join('\n')
  const context = items.map(d => `${d.title}：${d.metric}（門檻 ${d.threshold}）`).join('；').slice(0, 1500)
  const goal = typeof summary.goal === 'string' ? summary.goal : null

  // Generation-time gate: evaluate the combined card set once (no humanAction yet
  // → scores the 3 always-on dims, 1–10). Per-card behavior-aware re-scoring runs
  // later in the daily batch once a human adopts/dismisses.
  let finalCards = cards
  let result = await evaluateOutput({ output: combine(cards), context, goal, kind: 'diagnosis' }, evalKeys)

  if (!result.pass && result.judge !== 'none') {
    const retryHint = `${fewShot}\n上一版評分偏低（${result.evalScore}/10），原因：${result.evalReasons.join('；')}。請針對這些點改進後重出。`
    const retry = await runDiagnosisAgent(items, summary, apiKey, retryHint)
    if (retry) {
      const retryEval = await evaluateOutput({ output: combine(retry), context, goal, kind: 'diagnosis' }, evalKeys)
      if (retryEval.evalScore > result.evalScore) { finalCards = retry; result = retryEval }
    }
  }

  if (result.judge !== 'none') {
    const byId = new Map(items.map(d => [d.id, d]))
    await Promise.all(finalCards.map(async (c) => {
      const item = byId.get(c.refId)
      if (!item) return
      await writeFeedback(pageId, {
        source: 'diagnosis', goal, alertType: item.type,
        context: `${item.metric}｜${item.desc}`,
        output: `${c.title}：${c.why.join(' ')}`,
        evalScore: result.evalScore, evalReasons: result.evalReasons,
        weakestDimension: result.weakestDimension, recommendToFewShot: result.recommendToFewShot,
      }, `diag__${diagnosisCardKey(item)}`).catch(() => {})
    }))
  }
  return finalCards
}

// One Haiku call → enforced cards (or null on failure / bad output).
export async function runDiagnosisAgent(
  items: DiagItem[], summary: Record<string, number>, apiKey: string, fewShot?: string,
): Promise<AiDiagCard[] | null> {
  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system: [{ type: 'text', text: agentSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: agentUserMessage(items, summary, fewShot) }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseAndEnforceCards(raw, items)
  } catch {
    return null
  }
}

// Read the fingerprint cache; regenerate + store on miss. Returns null when there
// is nothing to diagnose or generation failed (callers fall back to rule text).
export async function getOrGenerateDiagnosisCards(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string, evalKeys?: EvalKeys,
): Promise<AiDiagCard[] | null> {
  if (selectItemsForAgent(items).length === 0) return null
  const fingerprint = computeDiagFingerprint(items)
  const latestRef = adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest')

  const cached = (await latestRef.get()).data()
  if (cached?.aiDiagnosisFingerprint === fingerprint && Array.isArray(cached.aiDiagnosis)) {
    return cached.aiDiagnosis as AiDiagCard[]
  }

  // Retrieval-augmented few-shot: proven past diagnosis outputs for this page.
  const fewShot = formatFewShot(
    await getFewShotExamples(pageId, { source: 'diagnosis', goal: typeof summary.goal === 'string' ? summary.goal : null }),
  )
  let cards = await runDiagnosisAgent(items, summary, apiKey, fewShot)
  if (!cards) return null

  // Quality evaluator (Slice 11): score → retry-once-if-low → store evalScore.
  if (evalKeys && (evalKeys.geminiKey || evalKeys.anthropicKey)) {
    cards = await evaluateAndStore(pageId, items, summary, apiKey, fewShot, cards, evalKeys)
  }

  await latestRef.set({
    aiDiagnosis: cards,
    aiDiagnosisFingerprint: fingerprint,
    aiDiagnosisUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return cards
}
