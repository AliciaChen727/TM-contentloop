// Diagnosis Agent — Phase 3, Layer 2 (LLM rewrite). Pure helpers around the Haiku
// call: select which items to send, fingerprint them for caching, build the
// prompt, parse the JSON, and ENFORCE that the LLM never changed severity/refId.
// The Anthropic SDK call itself lives in app/api/ai/diagnosis/route.ts (needs the
// key). See docs/phase-3-diagnosis-agent.md.

import { createHash } from 'crypto'
import type { DiagItem, AiDiagCard } from '@/components/ads/types'
import { META_AD_BENCHMARKS, ctrBenchmarkLine } from '@/lib/ads/benchmarks'

// content_* items are post diagnosis; everything else is ad diagnosis.
export function itemDomain(item: DiagItem): 'ad' | 'content' {
  return item.type.startsWith('content_') ? 'content' : 'ad'
}

const SEVERITY_EMOJI: Record<DiagItem['severity'], string> = { critical: '🚨', warning: '⚠️', good: '✅' }

// Card budget: all critical + warning, plus the top 2 good (optimization) items.
// Keeps email/page focused and caps token cost. Order is preserved.
export function selectItemsForAgent(items: DiagItem[]): DiagItem[] {
  const serious = items.filter((d) => d.severity === 'critical' || d.severity === 'warning')
  const goods = items.filter((d) => d.severity === 'good').slice(0, 2)
  return [...serious, ...goods]
}

// Fingerprint the SELECTED items' material content. Same findings → same hash →
// cache hit, regardless of which path produced them. Date range is irrelevant on
// purpose: identical diagnosis = identical cards.
export function computeDiagFingerprint(items: DiagItem[]): string {
  const basis = selectItemsForAgent(items)
    .map((d) => `${d.id}|${d.severity}|${d.type}|${d.metric}|${d.desc}`)
    .join('||')
  return createHash('sha1').update(basis).digest('hex').slice(0, 16)
}

interface AgentSummary {
  ctr?: number
  spend?: number
  cpa?: number
  frequency?: number
  conversions?: number
  reach?: number
}

// System prompt + benchmark reference. Marked as the cacheable prefix by the route.
export function agentSystemPrompt(en = false): string {
  const b = META_AD_BENCHMARKS
  if (en) {
    return [
      "You are the \"AI Ad Coach\" for a Toastmasters club. Tone: encouraging, practical, plain-spoken; give immediately actionable next steps. The audience is a non-technical club organizer.",
      '',
      'Task: rewrite each "diagnosis finding" into one action card. Style:',
      '- Use an outcome-oriented, plain-language title; do NOT use a metric name as the title (e.g. "This creative burns budget daily but gets no clicks", not "Low CTR").',
      '- why: 1–3 narrative sentences, in order: what the problem is → how it affects you → what we suggest.',
      '- impact: if you can quantify the impact from the data, write one sentence; otherwise leave an empty string.',
      '- Important: if a finding includes a note (pre-computed budget/estimate numbers), any amount or number in impact/why MUST use the note\'s numbers verbatim — never compute or invent your own.',
      '- benchmark: only ad metrics (CTR/CPC) may cite industry numbers; organic post engagement uses a different denominator, so leave benchmark as an empty string for those.',
      '- cta: label is a short button phrase (e.g. "Replace copy", "Boost this post"); askAi is the question to carry into the AI chat when clicked.',
      '',
      `Industry reference (ad metrics only): healthy CTR ${b.ctr.low}–${b.ctr.high}%; traffic CPC ~$${b.cpcTraffic.good}; lead CPC ~$${b.cpcLead.good}; nonprofit CPC annual avg $${b.nonprofitCpc.avg}.`,
      'FB/IG organic engagement dropped notably YoY in 2025 (FB ~-36%, IG ~-24%); if engagement is low, reassure the user "this is the broader environment, not your fault."',
      '',
      'Output STRICT JSON array only — no surrounding text or markdown. Each element:',
      '{"refId":string,"title":string,"why":string[],"impact":string,"benchmark":string,"cta":{"label":string,"askAi":string}}',
      'refId must correspond verbatim to the input finding\'s id. Do not add, remove, or change severities. Respond entirely in English.',
    ].join('\n')
  }
  return [
    '你是 Toastmasters 分會的「AI 廣告投手」。語氣鼓勵、務實、講人話，給可立即執行的下一步。對象是非工程師的分會經營者。',
    '',
    '任務：把每一條「診斷發現」改寫成一張行動卡片。風格參考：',
    '- 標題用「結果導向」白話，不要用指標名當標題（例：「這支素材每天燒錢卻沒人點」，不要「CTR 偏低」）。',
    '- why：1–3 句敘事，依序講「問題是什麼 → 對你的影響 → 我們建議怎麼做」。',
    '- impact：若能從數據量化影響就寫一句（例：「過去這段期間多花了 NT$X 卻沒帶來點擊」）；無法量化就留空字串。',
    '- 重要：若某筆發現附了 note（已算好的預算/預估數字），impact 與 why 中任何金額或數字都必須原封使用 note 的數字，絕不可自行計算或編造。',
    '- benchmark：只有廣告指標（CTR/CPC）才可引用同業數字；自然貼文互動率分母不同，benchmark 一律留空字串。',
    '- cta：label 是按鈕短句（例「更換文案」「加碼推廣這篇」），askAi 是點下去帶進 AI 對話的問句。',
    '',
    `同業參考（僅供廣告指標對比）：CTR 健康區間 ${b.ctr.low}–${b.ctr.high}%；流量型 CPC 約 $${b.cpcTraffic.good}；名單型 CPC 約 $${b.cpcLead.good}；非營利 CPC 年均 $${b.nonprofitCpc.avg}。`,
    'FB/IG 自然互動 2025 同比明顯下滑（FB 約 -36%、IG 約 -24%），若互動率偏低要安撫使用者「這是大環境，不代表你做錯」。',
    '',
    '嚴格只輸出 JSON 陣列，不要任何前後文字或 markdown。每個元素：',
    '{"refId":string,"title":string,"why":string[],"impact":string,"benchmark":string,"cta":{"label":string,"askAi":string}}',
    'refId 必須原封不動對應輸入發現的 id。不要新增、不要刪除、不要改變嚴重度。',
  ].join('\n')
}

// User message: the selected findings + a few account metrics for context, plus
// optional retrieved few-shot examples (proven past outputs) for self-learning.
export function agentUserMessage(items: DiagItem[], summary: AgentSummary, fewShot?: string): string {
  const selected = selectItemsForAgent(items)
  const ctxLines: string[] = []
  if (typeof summary.ctr === 'number' && summary.ctr > 0) ctxLines.push(ctrBenchmarkLine(summary.ctr))
  if (typeof summary.spend === 'number') ctxLines.push(`期間總花費約 $${Math.round(summary.spend)}`)
  if (typeof summary.frequency === 'number' && summary.frequency > 0) ctxLines.push(`頻率 ${summary.frequency.toFixed(2)}`)
  if (typeof summary.conversions === 'number') ctxLines.push(`轉換/點擊數 ${summary.conversions}`)

  const findings = selected.map((d) => ({
    id: d.id,
    severity: d.severity,
    domain: itemDomain(d),
    title: d.title,
    desc: d.desc,
    metric: d.metric,
    threshold: d.threshold,
    suggestedAction: d.action,
    ...(d.projection ? { note: d.projection } : {}),
  }))

  return [
    ctxLines.length ? `帳戶背景：${ctxLines.join('；')}。` : '帳戶背景：資料有限。',
    fewShot ? `\n${fewShot}\n` : '',
    '診斷發現（請逐一改寫成卡片，refId = 各 id）：',
    JSON.stringify(findings, null, 2),
  ].filter(Boolean).join('\n')
}

// Extract the first JSON array from the model output (it may wrap in prose/fences).
function extractJsonArray(raw: string): unknown[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Parse + ENFORCE invariants: severity/domain/emoji come from the source items
// (never trust the LLM), drop hallucinated refIds, keep input order. Returns null
// if nothing usable parsed → caller falls back to rule-template text.
export function parseAndEnforceCards(raw: string, items: DiagItem[]): AiDiagCard[] | null {
  const arr = extractJsonArray(raw)
  if (!arr) return null
  const selected = selectItemsForAgent(items)
  const byId = new Map(selected.map((d) => [d.id, d]))

  const cards: AiDiagCard[] = []
  for (const d of selected) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = arr.find((x: any) => x && String(x.refId) === d.id) as any
    if (!c) continue
    const why = Array.isArray(c.why) ? c.why.map((s: unknown) => String(s)).filter(Boolean).slice(0, 3) : []
    cards.push({
      refId: d.id,
      severity: d.severity,                       // enforced from source
      domain: itemDomain(d),                      // enforced from source
      emoji: SEVERITY_EMOJI[d.severity],
      title: c.title ? String(c.title).slice(0, 60) : d.title,
      why: why.length ? why : [d.desc],
      // Deterministic projection always wins for impact (accurate numbers).
      impact: d.projection ? d.projection : (c.impact ? String(c.impact) : ''),
      benchmark: c.benchmark ? String(c.benchmark) : '',
      cta: {
        label: c?.cta?.label ? String(c.cta.label).slice(0, 16) : '問 AI',
        askAi: c?.cta?.askAi ? String(c.cta.askAi) : `針對「${d.title}」我該怎麼做？`,
      },
    })
  }
  // Guard against a fully empty / unusable result.
  return cards.length > 0 && byId.size > 0 ? cards : null
}
