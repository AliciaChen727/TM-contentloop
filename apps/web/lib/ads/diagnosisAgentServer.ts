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
import { buildPageDataTools } from '@/lib/ai/tools/pageDataTools'
import { recordClaudeUsage } from '@/lib/usage'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'

export interface EvalKeys { geminiKey?: string | null; anthropicKey?: string | null }

// Quality-evaluate a card set (LLM-as-judge), retry generation once when below
// threshold (reasons fed back), then persist evalScore per card into feedback
// memory (docId diag__cardKey — same doc the human action later merges into).
async function evaluateAndStore(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string,
  fewShot: string, cards: AiDiagCard[], evalKeys: EvalKeys, recordUid?: string,
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
    // Retry with the tool loop too (evaluator reasons fed back + agent can
    // re-check the data), but bounded: fewer iterations + 25s cap so the whole
    // generate→eval→retry→eval chain stays inside the route's 60s budget.
    // Timeout / failure falls back to the original single-shot haiku retry.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000))
    let retry = await Promise.race([
      runDiagnosisAgentWithTools(pageId, items, summary, apiKey, retryHint, false, 4, recordUid),
      timeout,
    ])
    if (!retry) retry = await runDiagnosisAgent(items, summary, apiKey, retryHint, false, recordUid)
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
        diagTitle: item.title, diagDesc: item.desc, cardTitle: c.title, cardWhy0: c.why[0] ?? '',
        evalScore: result.evalScore, evalReasons: result.evalReasons,
        weakestDimension: result.weakestDimension, recommendToFewShot: result.recommendToFewShot,
      }, `diag__${diagnosisCardKey(item)}`).catch(() => {})
    }))
  }
  return finalCards
}

// Tool-use addendum appended to the system prompt when the agent runs with the
// Firestore tool loop (Slice 15). Keeps the base prompt (cacheable) unchanged.
function toolAddendum(en = false): string {
  if (en) {
    return [
      '',
      'You have tools: get_ad_insights (account trend + creatives), get_posts (recent FB/IG organic posts), get_feedback_memory (past adopted/high-scored advice for this page).',
      'Before writing the cards: use tools to check the trend behind each finding and to VERIFY every number you cite — cite only numbers present in the input or tool results, never computed or invented.',
      'You may think briefly between tool calls, but your FINAL reply must be the strict JSON array only — no other text.',
    ].join('\n')
  }
  return [
    '',
    '你有工具可用：get_ad_insights（帳戶趨勢＋素材）、get_posts（近期 FB/IG 自然貼文）、get_feedback_memory（此粉專過去被採用/高分的建議）。',
    '寫卡片前：先用工具查看各發現背後的趨勢，並「核對」你引用的每個數字——只能引用輸入或工具回傳中存在的數字，絕不可自行推算或編造。',
    '工具呼叫之間可以簡短思考，但「最終回覆」只能是嚴格的 JSON 陣列，不得有任何其他文字。',
  ].join('\n')
}

// Tool-loop version (Slice 15): sonnet + Firestore tools, whitelist = this page
// only. Multi-step: inspect trend → verify numbers → emit cards. Falls back to
// null on any failure (caller then tries the single-shot haiku path).
export async function runDiagnosisAgentWithTools(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string, fewShot?: string, en = false, maxIterations = 6, recordUid?: string,
): Promise<AiDiagCard[] | null> {
  try {
    const anthropic = new Anthropic({ apiKey })
    const tools = buildPageDataTools({ allowedPageIds: [pageId] })
    const runner = anthropic.beta.messages.toolRunner({
      model: 'claude-sonnet-4-6',
      max_tokens: 2400,
      max_iterations: maxIterations,
      system: [{ type: 'text', text: agentSystemPrompt(en) + '\n' + toolAddendum(en), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `pageId: ${pageId}\n${agentUserMessage(items, summary, fewShot)}` }],
      tools,
    })
    // Iterate so token usage accumulates across ALL tool turns (awaiting the runner
    // only exposes the final turn's tokens → undercount). rounds = tool-loop
    // observability (how many turns this diagnosis actually took).
    let final: Anthropic.Beta.BetaMessage | null = null
    let inTok = 0, outTok = 0, rounds = 0
    for await (const msg of runner) { final = msg; inTok += msg.usage.input_tokens; outTok += msg.usage.output_tokens; rounds++ }
    if (recordUid) await recordClaudeUsage(recordUid, { model: 'claude-sonnet-4-6', inputTokens: inTok, outputTokens: outTok })
    // Final answer = the LAST text block (earlier blocks may be inter-tool notes).
    const texts = (final?.content ?? []).filter((b) => b.type === 'text')
    const raw = texts.length ? texts[texts.length - 1].text : ''
    const cards = parseAndEnforceCards(raw, items)
    console.info('[diagnosisAgent] sonnet tool loop', JSON.stringify({ pageId, rounds, tokens: inTok + outTok, parsedOk: !!cards }))
    return cards
  } catch (err) {
    // Was silently swallowed → the sonnet path could fail every day (falling back
    // to haiku) with no signal. Log it; the orchestrator also counts it.
    console.error('[diagnosisAgent] sonnet tool loop threw for page', pageId, '-', err instanceof Error ? err.message : err)
    return null
  }
}

// One Haiku call → enforced cards (or null on failure / bad output).
export async function runDiagnosisAgent(
  items: DiagItem[], summary: Record<string, number>, apiKey: string, fewShot?: string, en = false, recordUid?: string,
): Promise<AiDiagCard[] | null> {
  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system: [{ type: 'text', text: agentSystemPrompt(en), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: agentUserMessage(items, summary, fewShot) }],
    })
    if (recordUid) await recordClaudeUsage(recordUid, { model: 'claude-haiku-4-5-20251001', inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseAndEnforceCards(raw, items)
  } catch (err) {
    console.error('[diagnosisAgent] haiku single-shot threw -', err instanceof Error ? err.message : err)
    return null
  }
}

// Lightweight health counter so a silently-degrading primary path (sonnet tool
// loop failing → daily haiku fallback) is quantifiable, not invisible. Best-effort,
// fire-and-forget — never blocks or fails diagnosis. Inspect: agentHealth/diagnosis.
function recordAgentHealth(field: 'sonnetOk' | 'sonnetFail' | 'bothFailed'): void {
  adminDb.collection('agentHealth').doc('diagnosis').set(
    { [field]: FieldValue.increment(1), [`${field}At`]: FieldValue.serverTimestamp() },
    { merge: true },
  ).catch(e => console.error('[diagnosisAgent] health counter write failed:', e))
}

// Read the fingerprint cache; regenerate + store on miss. Returns null when there
// is nothing to diagnose or generation failed (callers fall back to rule text).
export async function getOrGenerateDiagnosisCards(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string, evalKeys?: EvalKeys, en = false,
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
  // Primary: sonnet tool-loop (trend inspection + number verification, Slice 15);
  // fallback: the original single-shot haiku call. Retry-on-low-score inside
  // evaluateAndStore stays single-shot to bound latency/cost.
  // Attribute Claude cost to the page OWNER's usage doc (the cost page + admin
  // aggregate key on users/{uid}). Null owner (page without admins) → skip recording.
  const ownerUid = (await resolvePageOwnerUid(pageId).catch(() => null)) ?? undefined

  let cards = await runDiagnosisAgentWithTools(pageId, items, summary, apiKey, fewShot, en, 6, ownerUid)
  if (cards) {
    recordAgentHealth('sonnetOk')
  } else {
    // Sonnet path produced nothing (threw, or bad/unparseable output). Make the
    // degradation visible instead of silently serving the haiku fallback every time.
    recordAgentHealth('sonnetFail')
    console.warn('[diagnosisAgent] sonnet tool loop returned null for page', pageId, '→ falling back to haiku')
    cards = await runDiagnosisAgent(items, summary, apiKey, fewShot, en, ownerUid)
  }
  if (!cards) { recordAgentHealth('bothFailed'); return null }

  // Quality evaluator (Slice 11): score → retry-once-if-low → store evalScore.
  if (evalKeys && (evalKeys.geminiKey || evalKeys.anthropicKey)) {
    cards = await evaluateAndStore(pageId, items, summary, apiKey, fewShot, cards, evalKeys, ownerUid)
  }

  await latestRef.set({
    aiDiagnosis: cards,
    aiDiagnosisFingerprint: fingerprint,
    aiDiagnosisUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return cards
}
