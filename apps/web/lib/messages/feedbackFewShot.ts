// T3 自我學習：檢索「過去被讚的類似回覆」當 few-shot（風格 + 正確資訊參考）。
// 同 Phase 3 sidekick feedbackRetrieval 思路，但範圍限本粉專 faqBot 的回饋。
import { adminDb } from '@/lib/firebase/admin'
import { geminiEmbed, cosineSim } from '@/lib/ai/geminiEmbed'

export interface FewShot { question: string; reply: string; sim: number }

export async function getFewShot(pageId: string, message: string, geminiKey: string | null, n = 3): Promise<FewShot[]> {
  if (!geminiKey || !message.trim()) return []
  let qVec: number[]
  try { qVec = await geminiEmbed(message, geminiKey) } catch { return [] }

  const snap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
    .collection('feedbackItems').where('rating', '==', 'up').limit(200).get()

  const scored: FewShot[] = []
  snap.forEach(d => {
    const data = d.data()
    if (!Array.isArray(data.embedding) || !data.message || !data.reply) return
    scored.push({ question: String(data.message), reply: String(data.reply), sim: cosineSim(qVec, data.embedding as number[]) })
  })
  return scored.sort((a, b) => b.sim - a.sim).filter(s => s.sim > 0.6).slice(0, n)
}
