export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface MetricsContext {
  totalPosts?: number
  totalReach?: number
  totalLikes?: number
  totalComments?: number
  totalShares?: number
  avgEngRate?: number
  reelsCount?: number
  dateRange?: string
  topPosts?: { title: string; reach: number; likes: number; engRate: number; platform: string }[]
}

function buildSystemPrompt(contextPage: string, metrics?: MetricsContext, memory?: string): string {
  const isPostsContext = contextPage === 'posts' || contextPage === 'combined'

  const role = isPostsContext
    ? '你是一位專精 Facebook 和 Instagram 社群經營的內容顧問，核心任務是協助分析貼文成效、找出高互動規律，並給出具體可執行的內容優化建議。'
    : '你是一位專精 Meta 廣告投放的資深廣告顧問，核心任務是分析廣告帳戶數據（ROAS、CPA、CTR、觸及、頻率等），診斷成效問題，並給出具體可執行的優化行動。'

  const memoryBlock = memory
    ? `\n## 過去分析記憶（請優先建立在這些結論上）\n${memory}\n`
    : ''

  let metricsBlock = ''
  if (metrics && Object.keys(metrics).length > 0) {
    metricsBlock = `
## 用戶當前數據（${metrics.dateRange ?? '近期'}）
- 總貼文數：${metrics.totalPosts ?? 'N/A'}（其中 Reels：${metrics.reelsCount ?? 'N/A'}）
- 總觸擊：${metrics.totalReach?.toLocaleString('zh-TW') ?? 'N/A'}
- 總按讚：${metrics.totalLikes?.toLocaleString('zh-TW') ?? 'N/A'}
- 留言：${metrics.totalComments?.toLocaleString('zh-TW') ?? 'N/A'}
- 分享：${metrics.totalShares?.toLocaleString('zh-TW') ?? 'N/A'}
- 平均互動率：${metrics.avgEngRate?.toFixed(2) ?? 'N/A'}%
${metrics.topPosts?.length ? `
## 近期貼文表現
${metrics.topPosts.map((p, i) => `${i + 1}. [${p.platform}] ${p.title.slice(0, 40)}... | 觸擊 ${p.reach} | 按讚 ${p.likes} | 互動率 ${p.engRate}%`).join('\n')}` : ''}`
  }

  return `${role}

## 行為準則
【實話實說】：直接點出問題，不過度浮誇，不捏造數字。若數據不足，明確說明「數據不足，無法判斷」。
【先分析再建議】：先理解數據脈絡（趨勢、異常、對比）再給建議，不跳過分析直接給結論。
【主動釐清】：當問題語意模糊時，在 bullets 中提出 2 個選項讓用戶選擇，例如「你想了解 A 還是 B？」。
【正負指標明確】：正面數據（如 ROAS 達標、互動率高於均值）與負面數據（如 CPA 過高、頻率疲勞）要明確區分，不混為一談。
【建議具體可執行】：每條 actions 要有具體數字或對象，例如「將受眾 A 的日預算從 $X 提高至 $Y」，而非「考慮調整預算」。
${memoryBlock}
## 回傳格式
繁體中文。直接輸出純 JSON 物件，禁止包在 markdown code block 裡，禁止任何說明文字，只輸出 JSON：
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general" | "image_request",
  "summary": "一句話結論，包含最關鍵的指標數字",
  "bullets": ["重點1（含數據）", "重點2（含判斷）", "重點3", "重點4"],
  "stats": [{"label": "指標名", "value": "數值（含單位）"}],
  "actions": ["具體行動1（含對象與數字）", "具體行動2", "具體行動3"],
  "imagePrompt": "（僅在 type 為 image_request 時填入）英文圖像生成提示詞"
}

規則：
- summary 必須含有具體數字，不能只說「表現良好」
- bullets 最多 4 條，每條不超過 50 字，有數據的優先
- stats 最多 3 個，只挑最關鍵的指標
- actions 最多 4 條，每條都要具體到「對誰做什麼，目標是多少」
- 若數據全為 0 或缺失，type 用 "warning"，在 summary 說明資料不完整，不要硬給建議
- 當使用者詢問廣告素材、圖片、視覺設計，或說「生成」「做一張」「廣告圖」「素材」時：
  - 回傳 type: "image_request"
  - imagePrompt：英文提示詞，格式：「Professional Facebook/Instagram ad for [主題], [風格描述], vibrant colors, clean modern design, high quality」
${metricsBlock}`
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const body = await req.json()
  const { message, contextPage, metricsContext } = body as {
    message: string
    contextPage: string
    metricsContext?: MetricsContext
  }

  if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  let memory = ''
  try {
    const pastSnap = await adminDb
      .collection('users').doc(uid)
      .collection('aiInsights')
      .where('contextPage', '==', contextPage)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get()
    memory = pastSnap.docs
      .map(d => {
        const r = (d.data().response ?? {}) as { summary?: string; actions?: string[] }
        const actions = (r.actions ?? []).slice(0, 2).join('、')
        return `• ${r.summary ?? ''}${actions ? `（建議：${actions}）` : ''}`
      })
      .filter(Boolean)
      .join('\n')
  } catch { /* Firestore index missing or other error: non-critical, proceed without memory */ }

  const systemPrompt = buildSystemPrompt(contextPage, metricsContext, memory || undefined)

  let claudeRes
  try {
    claudeRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Claude API error: ' + msg }, { status: 500 })
  }

  const rawText = claudeRes.content[0].type === 'text' ? claudeRes.content[0].text : ''
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  let parsed: object
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = { type: 'general', summary: cleaned, bullets: [], stats: [], actions: [] }
  }

  try {
    await adminDb.collection('users').doc(uid).collection('aiInsights').add({
      question: message,
      response: parsed,
      contextPage,
      metricsSnapshot: metricsContext ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch { /* non-critical */ }

  return NextResponse.json({ response: parsed })
}
