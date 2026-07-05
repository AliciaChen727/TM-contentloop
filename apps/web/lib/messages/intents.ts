// Phase 5-1 擴充：私訊「問題分類」意圖分類法 + 批次分類器（Gemini）。
// 分類只在 server 端做，原文不回傳 client。分類結果存 page-scoped 並設 TTL。
import { geminiGenerateText } from '@/lib/ai/geminiText'

// Bump when the taxonomy/prompt changes → stored classifications with an older
// version are re-classified instead of served from cache.
export const CLASSIFIER_VERSION = 2

export type IntentKey =
  | 'meeting_time' | 'location' | 'event_content' | 'join' | 'pricing' | 'trial' | 'contact' | 'other'

export const INTENTS: { key: IntentKey; zh: string; en: string; hint: string }[] = [
  { key: 'meeting_time', zh: '例會／活動時間', en: 'Meeting time', hint: '問例會、活動、聚會的時間、日期、頻率' },
  { key: 'location', zh: '地點', en: 'Location', hint: '問地址、在哪裡、怎麼去、線上或實體' },
  { key: 'event_content', zh: '活動內容詢問', en: 'Event content', hint: '問活動／例會的內容、主題、流程、會做什麼、有哪些環節、近期有哪些活動' },
  { key: 'join', zh: '如何加入／報名', en: 'How to join', hint: '問怎麼加入、報名、入會、成為會員、名額' },
  { key: 'pricing', zh: '費用／價格', en: 'Pricing', hint: '問費用、會費、價格、多少錢、優惠' },
  { key: 'trial', zh: '體驗／初次參加', en: 'First visit', hint: '問可否來賓體驗、第一次參加要注意什麼、需要準備什麼' },
  { key: 'contact', zh: '聯絡／窗口', en: 'Contact', hint: '要聯絡人、窗口、電話、想找誰、合作邀約' },
  { key: 'other', zh: '其他', en: 'Other', hint: '以上都不符合、閒聊、感謝、無法判斷' },
]

const KEYS = new Set<IntentKey>(INTENTS.map(i => i.key))
export const intentLabel = (key: string, en: boolean): string => {
  const found = INTENTS.find(i => i.key === key)
  return found ? (en ? found.en : found.zh) : (en ? 'Other' : '其他')
}

const SYSTEM = `你是客服訊息意圖分類器。將每則用戶私訊分到「唯一一個」最貼切的類別。只能用這些 key：
${INTENTS.map(i => `- ${i.key}：${i.hint}`).join('\n')}
規則：回覆「純 JSON 陣列」，每個元素是 {"i": 序號, "intent": "key"}，不要多餘文字。無法判斷用 "other"。`

// Classify a batch of inbound message texts → intent key per text (same order).
// Chunked to keep prompts small; tolerant of parse failures (→ 'other').
export async function classifyMessages(texts: string[], apiKey: string): Promise<IntentKey[]> {
  const out: IntentKey[] = new Array(texts.length).fill('other')
  const CHUNK = 25
  for (let start = 0; start < texts.length; start += CHUNK) {
    const slice = texts.slice(start, start + CHUNK)
    const prompt = slice.map((t, i) => `${i}. ${(t || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    try {
      const raw = await geminiGenerateText({ apiKey, system: SYSTEM, prompt, temperature: 0, maxOutputTokens: 1200 })
      const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
      const parsed = JSON.parse(json) as { i: number; intent: string }[]
      for (const p of parsed) {
        if (typeof p.i === 'number' && p.i >= 0 && p.i < slice.length) {
          out[start + p.i] = KEYS.has(p.intent as IntentKey) ? (p.intent as IntentKey) : 'other'
        }
      }
    } catch {
      // leave this chunk as 'other' — never fail the whole classify run
    }
  }
  return out
}
