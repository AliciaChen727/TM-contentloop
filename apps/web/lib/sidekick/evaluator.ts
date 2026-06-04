// Quality evaluator (LLM-as-judge) for Phase 3 self-learning. Scores an AI output
// (Sidekick reply or diagnosis card) against a behavior-aware rubric.
//
// Dual mode:
//  - generation-time gate: only output/context (+ diagItem/aiDiagCard) available →
//    scores the 3 always-on dims, no human/effect weighting.
//  - post-behavior re-score (daily batch): humanAction / adoptedText /
//    adMetricsAfter present → adds adoptionAlignment + effectValidation dims and
//    applies the adopt/reject + effect weighting.
//
// Cross-model judging: prefer Gemini (generators use Claude → a Claude judge would
// have self-preference bias). Falls back to Claude Haiku. temperature 0 for
// reproducible scores. JSON in/out. Layer-1 severity/refId are NEVER touched here.

import Anthropic from '@anthropic-ai/sdk'
import { geminiGenerateText } from '@/lib/ai/geminiText'

export type HumanAction = 'adopted' | 'edited' | 'rejected'

export interface AdMetricsAfter {
  ctr?: number; cpc?: number; roas?: number
  deltaVsBefore?: { ctr?: number; cpc?: number; roas?: number }
}

// Raw 1–5 per dimension. Optional dims are absent when not applicable.
export interface EvalScores {
  diagnosisAccuracy?: number  // why[] 是否與 metric/threshold 一致
  actionability?: number      // cta / 步驟是否具體可執行
  clarity?: number            // title/impact 非專業用戶看得懂
  adoptionAlignment?: number  // 與 adoptedText 語意一致（rejected → 1）
  effectValidation?: number   // 採納後 CTR/ROAS 是否改善（需 adMetricsAfter）
}

const DIM_LABELS: Record<keyof EvalScores, string> = {
  diagnosisAccuracy: '診斷準確性',
  actionability: '行動可執行性',
  clarity: '語言清晰度',
  adoptionAlignment: '採納訊號吻合度',
  effectValidation: '效果驗證',
}

export interface EvalResult {
  evalScore: number              // 加權後總分 1–10
  evalReasons: string[]          // 每個評分維度一句話理由
  weakestDimension: string       // 分數最低維度（中文標籤）
  recommendToFewShot: boolean    // evalScore >= 7 且 humanAction='adopted'
  scores: EvalScores             // 原始 1–5 per dim
  base: number                   // 已評維度平均（1–5）
  judge: 'gemini' | 'claude' | 'none'
  pass: boolean                  // evalScore >= EVAL_PASS
}

export interface EvalInput {
  kind: 'sidekick' | 'diagnosis'
  output: string                 // 受評產出文字（sidekick 回覆 / 卡片摘要）
  context: string                // 廣告數據快照 / 對話情境
  goal?: string | null
  brandTone?: string | null
  // diagnosis: Layer-1 原始發現 + Layer-2 改寫卡（讓 judge 比對準確性）
  diagItem?: { title?: string; desc?: string; metric?: string; threshold?: string } | null
  aiDiagCard?: { title?: string; why?: string[]; impact?: string; cta?: { label?: string } } | null
  // 行為訊號（生成時為 null）
  humanAction?: HumanAction | null
  adoptedText?: string | null
  adMetricsAfter?: AdMetricsAfter | null
}

export const EVAL_PASS = 7          // 1–10 制的通過門檻
export const FEWSHOT_MIN = 7        // 進 few-shot 的最低分

const SYSTEM = '你是嚴格但公正的廣告文案品質評審。只回 JSON，不要任何前後文字或 markdown。'

// Which dims to score for this input (drives prompt + parsing).
function applicableDims(input: EvalInput): (keyof EvalScores)[] {
  const dims: (keyof EvalScores)[] = ['diagnosisAccuracy', 'actionability', 'clarity']
  if (input.humanAction) dims.push('adoptionAlignment')
  if (input.adMetricsAfter) dims.push('effectValidation')
  return dims
}

function buildPrompt(input: EvalInput, dims: (keyof EvalScores)[]): string {
  const lines: string[] = [
    '為「待評產出」逐項評分，每項 1–5（5 最好）。只評列出的維度：',
    dims.includes('diagnosisAccuracy') ? '- diagnosisAccuracy：改寫建議(why)的原因是否與原始數據發現的 metric/threshold 一致，不誇大不偏離。' : '',
    dims.includes('actionability') ? '- actionability：行動建議/CTA 是否具體，SMB 廣告主能否立即操作。' : '',
    dims.includes('clarity') ? '- clarity：標題與影響說明是否讓非專業用戶看懂。' : '',
    dims.includes('adoptionAlignment') ? `- adoptionAlignment：建議內容與「用戶實際採用版本」語意是否一致${input.humanAction === 'rejected' ? '（注意：此筆已被拒絕，此項給 1）' : ''}。` : '',
    dims.includes('effectValidation') ? '- effectValidation：採納後 CTR/ROAS 是否改善（看 deltaVsBefore，改善高分、惡化低分）。' : '',
    '',
    `情境類型：${input.kind === 'sidekick' ? 'AI Sidekick 對話回覆' : '廣告診斷建議卡'}`,
    input.goal ? `行銷目標：${input.goal}` : '',
    input.brandTone ? `品牌語氣：${input.brandTone}` : '',
    '',
    `【情境/數據】\n${input.context.slice(0, 1500)}`,
  ]
  if (input.diagItem) {
    lines.push(`\n【原始數據發現】${input.diagItem.title ?? ''}｜${input.diagItem.desc ?? ''}｜${input.diagItem.metric ?? ''}（門檻 ${input.diagItem.threshold ?? '-'}）`)
  }
  if (input.aiDiagCard) {
    lines.push(`\n【AI 改寫卡】${input.aiDiagCard.title ?? ''}｜why: ${(input.aiDiagCard.why ?? []).join(' ')}｜impact: ${input.aiDiagCard.impact ?? ''}｜cta: ${input.aiDiagCard.cta?.label ?? ''}`)
  }
  lines.push(`\n【待評產出】\n${input.output.slice(0, 1500)}`)
  if (input.humanAction) lines.push(`\n【用戶行為】humanAction=${input.humanAction}${input.adoptedText ? `；採用版本：${input.adoptedText.slice(0, 600)}` : ''}`)
  if (input.adMetricsAfter?.deltaVsBefore) {
    const d = input.adMetricsAfter.deltaVsBefore
    lines.push(`\n【採納後成效變化】ΔCTR=${d.ctr ?? 0}、ΔCPC=${d.cpc ?? 0}、ΔROAS=${d.roas ?? 0}`)
  }
  const keys = dims.map(d => `"${d}":n`).join(',')
  lines.push(`\n只輸出 JSON：{${keys},"reasons":{${dims.map(d => `"${d}":"一句話理由"`).join(',')}}}`)
  return lines.filter(Boolean).join('\n')
}

function parseEval(raw: string, dims: (keyof EvalScores)[]): { scores: EvalScores; reasons: string[] } | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const o = JSON.parse(raw.slice(start, end + 1))
    const clamp = (v: unknown) => Math.max(1, Math.min(5, Number(v) || 1))
    const scores: EvalScores = {}
    const reasons: string[] = []
    const rObj = (o.reasons && typeof o.reasons === 'object') ? o.reasons as Record<string, unknown> : {}
    for (const d of dims) {
      scores[d] = clamp(o[d])
      const r = rObj[d]
      reasons.push(`${DIM_LABELS[d]}：${typeof r === 'string' && r ? r : '無'}`)
    }
    return { scores, reasons }
  } catch {
    return null
  }
}

function adMetricsImproved(m?: AdMetricsAfter | null): boolean {
  const d = m?.deltaVsBefore
  if (!d) return false
  return (d.roas ?? 0) > 0 || (d.ctr ?? 0) > 0 || (d.cpc ?? 0) < 0  // cpc 下降 = 改善
}

function finalize(
  input: EvalInput, dims: (keyof EvalScores)[],
  parsed: { scores: EvalScores; reasons: string[] }, judge: 'gemini' | 'claude',
): EvalResult {
  const vals = dims.map(d => parsed.scores[d] ?? 0)
  const base = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) // 1–5

  // 1–5 → 2–10 base, then behavior weighting.
  let score = base * 2
  if (input.humanAction === 'adopted' && adMetricsImproved(input.adMetricsAfter)) score *= 1.3
  if (input.humanAction === 'rejected') score *= 0.6
  const evalScore = parseFloat(Math.max(1, Math.min(10, score)).toFixed(1))

  // Weakest scored dimension (lowest raw 1–5).
  let weakKey = dims[0]
  for (const d of dims) if ((parsed.scores[d] ?? 5) < (parsed.scores[weakKey] ?? 5)) weakKey = d

  return {
    evalScore,
    evalReasons: parsed.reasons,
    weakestDimension: DIM_LABELS[weakKey],
    recommendToFewShot: evalScore >= FEWSHOT_MIN && input.humanAction === 'adopted',
    scores: parsed.scores,
    base,
    judge,
    pass: evalScore >= EVAL_PASS,
  }
}

const NONE: EvalResult = {
  evalScore: 0, evalReasons: ['evaluator unavailable'], weakestDimension: '',
  recommendToFewShot: false, scores: {}, base: 0, judge: 'none', pass: false,
}

// Judge an output. Gemini first (temp 0), then Claude Haiku. judge:'none' only
// when both unavailable — callers treat 'none' as "unscored", not a real 0.
export async function evaluateOutput(
  input: EvalInput,
  keys: { geminiKey?: string | null; anthropicKey?: string | null },
): Promise<EvalResult> {
  const dims = applicableDims(input)
  const prompt = buildPrompt(input, dims)

  if (keys.geminiKey) {
    try {
      const raw = await geminiGenerateText({ apiKey: keys.geminiKey, system: SYSTEM, prompt, temperature: 0, maxOutputTokens: 500 })
      const parsed = parseEval(raw, dims)
      if (parsed) return finalize(input, dims, parsed, 'gemini')
    } catch (e) {
      // If this fires consistently the Gemini judge model may be retired — see
      // project_gemini_text_models memory. Evaluation still works via Claude.
      console.warn('[evaluator] Gemini judge failed, falling back to Claude:', e instanceof Error ? e.message : e)
    }
  }

  if (keys.anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: keys.anthropicKey })
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
      const parsed = parseEval(raw, dims)
      if (parsed) return finalize(input, dims, parsed, 'claude')
    } catch { /* fall through to none */ }
  }

  return NONE
}
