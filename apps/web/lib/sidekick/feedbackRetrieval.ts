// Retrieval-augmented few-shot for Phase 3 self-learning. Pulls proven examples
// from pages/{pageId}/sidekickFeedback, ranked by human adoption then eval score,
// and formats them for prompt injection. Falls back to cold-start seeds when the
// page hasn't accumulated feedback yet. See docs/phase-3-sidekick-self-learning.md.

import { adminDb } from '@/lib/firebase/admin'
import { geminiEmbed, cosineSim } from '@/lib/ai/geminiEmbed'

export interface FewShotExample { context: string; text: string; why?: string }

interface Query { source: 'sidekick' | 'diagnosis'; goal?: string | null; alertType?: string | null }

// Hand-written cold-start seeds (Toastmasters / 非營利 語氣) so the loop produces
// good output before any real feedback exists. Replaced naturally as adopted
// examples accumulate.
const SEEDS: Record<'sidekick' | 'diagnosis', FewShotExample[]> = {
  diagnosis: [
    { context: 'CTR 0.20%，低於建議 1.5%', text: '這支素材每天燒錢卻沒人點——前 3 秒的鉤子不夠強。建議把開頭換成一個具體痛點問句（例「還在為分會招生煩惱？」），並把報名連結講白。', why: '具體、對症、可立即執行' },
    { context: '某貼文自然互動率最高且未投廣告', text: '這篇已被你的受眾驗證有效，卻只有熟粉看到。用小額預算（每日 NT$100–150、7 天）把它推給相似受眾，等於放大已知會贏的內容。', why: '加碼已驗證內容，風險低' },
  ],
  sidekick: [
    { context: '使用者問「這週該做什麼」', text: '本週聚焦三件事：1) 暫停 CTR 最低的那支素材止血；2) 把互動最高的貼文加碼推廣；3) 集中在週二、四晚間發文（你的高互動時段）。', why: '清單化、可執行、結合該帳戶數據' },
  ],
}

// Normalize evalScore to the 1–10 scale: legacy rows stored the old 0–5 mean, so
// values <=5 are doubled. New behavior-aware scores are already 1–10.
function norm10(v: unknown): number {
  if (typeof v !== 'number') return 0
  return v <= 5 ? v * 2 : v
}

// evalReasons may be legacy string or new string[] — render as one line.
function reasonText(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined
  if (Array.isArray(v)) return v.join('；') || undefined
  return undefined
}

function matchScore(d: Record<string, unknown>, q: Query): number {
  let s = 0
  if (d.humanAction === 'adopted') s += 100
  else if (d.humanAction === 'edited') s += 60
  s += norm10(d.evalScore) * 5           // 1–10 → up to 50
  if (q.goal && d.goal === q.goal) s += 8
  if (q.alertType && d.alertType === q.alertType) s += 8
  return s
}

// Top-N proven examples for this page + source, best first.
export async function getFewShotExamples(pageId: string, q: Query, n = 3): Promise<FewShotExample[]> {
  let examples: FewShotExample[] = []
  try {
    // Fetch recent feedback (single-field index only), filter + rank in memory to
    // avoid composite-index setup.
    const snap = await adminDb.collection('pages').doc(pageId).collection('sidekickFeedback')
      .orderBy('createdAt', 'desc').limit(100).get()
    const rows = snap.docs
      .map(d => d.data())
      .filter(d => d.source === q.source && d.humanAction !== 'rejected' && (d.adoptedText || d.output))
      .sort((a, b) => matchScore(b, q) - matchScore(a, q))
      .slice(0, n)
    examples = rows.map(d => ({
      context: String(d.context ?? ''),
      text: String(d.adoptedText ?? d.output ?? ''),
      why: reasonText(d.evalReasons),
    }))
  } catch { /* fall through to seeds */ }

  if (examples.length < n) {
    const seeds = SEEDS[q.source] ?? []
    for (const seed of seeds) {
      if (examples.length >= n) break
      if (!examples.some(e => e.text === seed.text)) examples.push(seed)
    }
  }
  return examples
}

// Semantic retrieval for Sidekick (free-text queries): embed the current query,
// cosine-rank past sidekick examples that have stored embeddings, blended with the
// adoption/eval signal. Falls back to metadata getFewShotExamples when there's no
// Gemini key, embedding fails, or no embedded examples exist yet.
export async function getSidekickFewShot(
  pageId: string, queryText: string, q: Omit<Query, 'source'>, geminiKey: string | null, n = 3,
): Promise<FewShotExample[]> {
  const fallback = () => getFewShotExamples(pageId, { source: 'sidekick', ...q }, n)
  if (!geminiKey || !queryText.trim()) return fallback()

  let qVec: number[]
  try {
    qVec = await geminiEmbed(queryText, geminiKey)
  } catch {
    return fallback()
  }

  try {
    const snap = await adminDb.collection('pages').doc(pageId).collection('sidekickFeedback')
      .orderBy('createdAt', 'desc').limit(100).get()
    const scored = snap.docs
      .map(d => d.data())
      .filter(d => d.source === 'sidekick' && d.humanAction !== 'rejected' && Array.isArray(d.embedding) && (d.adoptedText || d.output))
      .map(d => {
        const sim = cosineSim(qVec, d.embedding as number[])
        const signal = (d.humanAction === 'adopted' ? 0.15 : 0) + norm10(d.evalScore) / 100
        return { d, score: sim + signal }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
    const examples = scored.map(({ d }) => ({
      context: String(d.context ?? ''),
      text: String(d.adoptedText ?? d.output ?? ''),
      why: reasonText(d.evalReasons),
    }))
    return examples.length > 0 ? examples : fallback()
  } catch {
    return fallback()
  }
}

// Render examples as a prompt block (empty string when none).
export function formatFewShot(examples: FewShotExample[], heading = '過去被採用 / 高分的優質範例（風格參考，勿照抄）：'): string {
  if (examples.length === 0) return ''
  const body = examples
    .map((e, i) => `範例 ${i + 1}｜情境：${e.context}\n產出：${e.text}${e.why ? `\n(為何好：${e.why})` : ''}`)
    .join('\n\n')
  return `${heading}\n${body}`
}
