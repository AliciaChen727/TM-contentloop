// Quality evaluator (LLM-as-judge) for Phase 3 self-learning. Scores an AI output
// (Sidekick reply or diagnosis card) against a fixed rubric, 0–5 per dimension.
//
// Cross-model judging: prefer Gemini (the Sidekick/diagnosis generators use Claude,
// so a Claude judge would have self-preference bias). Falls back to Claude Haiku
// when no Gemini key / Gemini fails. Pure aside from the LLM calls — JSON in/out.

import Anthropic from '@anthropic-ai/sdk'
import { geminiGenerateText } from '@/lib/ai/geminiText'

export interface EvalScores {
  relevance: number      // 對應該情境的問題
  goalFit: number        // 貼合 optimizationGoal
  actionability: number  // 具體可執行
  brandVoice: number     // 品牌語氣
  noFabrication: number  // 無捏造
}

export interface EvalResult {
  scores: EvalScores
  overall: number          // 0–5 (mean of dimensions)
  reasons: string          // 扣分/加分理由
  pass: boolean            // overall >= threshold
  judge: 'gemini' | 'claude' | 'none'  // which model judged (or none on total failure)
}

export interface EvalInput {
  output: string                 // the AI text being judged
  context: string                // ad/post data summary or conversation context
  goal?: string | null           // optimizationGoal
  brandTone?: string | null      // brandName / tone hint
  kind: 'sidekick' | 'diagnosis'
}

export const EVAL_THRESHOLD = 3.5

const SYSTEM = '你是嚴格但公正的廣告文案品質評審。只回 JSON，不要任何前後文字或 markdown。'

function buildPrompt(input: EvalInput): string {
  return [
    '依下列五個維度為「待評產出」評分，每項 0–5（5 最好）：',
    '- relevance：是否真的對應該情境的問題（CTR 掉就改 hook，不是亂改）。',
    '- goalFit：是否貼合行銷目標。',
    '- actionability：是否給得出可直接用的文案/步驟，而非空泛口號。',
    '- brandVoice：是否符合品牌語氣。',
    '- noFabrication：有沒有杜撰活動、數字、不實承諾（捏造則此項給低分）。',
    '',
    `情境類型：${input.kind === 'sidekick' ? 'AI Sidekick 對話回覆' : '廣告/貼文診斷建議卡'}`,
    input.goal ? `行銷目標：${input.goal}` : '',
    input.brandTone ? `品牌語氣：${input.brandTone}` : '',
    '',
    `【情境/數據】\n${input.context.slice(0, 2000)}`,
    '',
    `【待評產出】\n${input.output.slice(0, 2000)}`,
    '',
    '只輸出 JSON：{"relevance":n,"goalFit":n,"actionability":n,"brandVoice":n,"noFabrication":n,"reasons":"一句話說明主要扣分/加分點"}',
  ].filter(Boolean).join('\n')
}

function parseEval(raw: string): { scores: EvalScores; reasons: string } | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const o = JSON.parse(raw.slice(start, end + 1))
    const clamp = (v: unknown) => Math.max(0, Math.min(5, Number(v) || 0))
    return {
      scores: {
        relevance: clamp(o.relevance),
        goalFit: clamp(o.goalFit),
        actionability: clamp(o.actionability),
        brandVoice: clamp(o.brandVoice),
        noFabrication: clamp(o.noFabrication),
      },
      reasons: typeof o.reasons === 'string' ? o.reasons : '',
    }
  } catch {
    return null
  }
}

function finalize(parsed: { scores: EvalScores; reasons: string }, judge: 'gemini' | 'claude'): EvalResult {
  const vals = Object.values(parsed.scores)
  const overall = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
  return { scores: parsed.scores, overall, reasons: parsed.reasons, pass: overall >= EVAL_THRESHOLD, judge }
}

const ZERO: EvalScores = { relevance: 0, goalFit: 0, actionability: 0, brandVoice: 0, noFabrication: 0 }

// Judge an output. Tries Gemini first, then Claude Haiku. Returns judge:'none'
// (overall 0, pass=false) only when both are unavailable/failed — callers should
// treat 'none' as "unscored", not as a real low score.
export async function evaluateOutput(
  input: EvalInput,
  keys: { geminiKey?: string | null; anthropicKey?: string | null },
): Promise<EvalResult> {
  const prompt = buildPrompt(input)

  if (keys.geminiKey) {
    try {
      const raw = await geminiGenerateText({ apiKey: keys.geminiKey, system: SYSTEM, prompt, maxOutputTokens: 400 })
      const parsed = parseEval(raw)
      if (parsed) return finalize(parsed, 'gemini')
    } catch { /* fall through to Claude */ }
  }

  if (keys.anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: keys.anthropicKey })
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
      const parsed = parseEval(raw)
      if (parsed) return finalize(parsed, 'claude')
    } catch { /* fall through to none */ }
  }

  return { scores: ZERO, overall: 0, reasons: 'evaluator unavailable', pass: false, judge: 'none' }
}
