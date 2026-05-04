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

function buildSystemPrompt(contextPage: string, metrics?: MetricsContext): string {
  const role = contextPage === 'posts' || contextPage === 'combined'
    ? '你是一位專業的社群媒體內容顧問，專長是 Facebook 和 Instagram 貼文的成效分析與優化建議。'
    : '你是一位專業的 Meta 廣告投手助手，專長是廣告帳戶分析與優化建議。'

  let metricsBlock = ''
  if (metrics && Object.keys(metrics).length > 0) {
    metricsBlock = `
## 用戶當前數據（${metrics.dateRange ?? '近期'}）
- 總貼文數：${metrics.totalPosts ?? 'N/A'}（其中 Reels：${metrics.reelsCount ?? 'N/A'}）
- 總觸擊（IG）：${metrics.totalReach?.toLocaleString('zh-TW') ?? 'N/A'}
- 總按讚：${metrics.totalLikes?.toLocaleString('zh-TW') ?? 'N/A'}
- 留言：${metrics.totalComments?.toLocaleString('zh-TW') ?? 'N/A'}
- 分享：${metrics.totalShares?.toLocaleString('zh-TW') ?? 'N/A'}
- 平均互動率：${metrics.avgEngRate?.toFixed(2) ?? 'N/A'}%
${metrics.topPosts?.length ? `
## 近期貼文表現（前幾筆）
${metrics.topPosts.map((p, i) => `${i + 1}. [${p.platform}] ${p.title.slice(0, 40)}... | 觸擊 ${p.reach} | 按讚 ${p.likes} | 互動率 ${p.engRate}%`).join('\n')}` : ''}`
  }

  return `${role}

你的回應格式必須是繁體中文。直接輸出純 JSON 物件，禁止包在 markdown code block 裡，禁止輸出任何說明文字，只輸出 JSON 本身：
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general",
  "summary": "一句話摘要",
  "bullets": ["重點1", "重點2", "重點3"],
  "stats": [{"label": "指標名", "value": "數值"}],
  "actions": ["建議行動1", "建議行動2", "建議行動3"]
}

規則：
- bullets 最多 4 條，每條不超過 50 字
- stats 最多 3 個
- actions 最多 4 條，具體可執行
- 如果沒有相關數據，stats 可以為空陣列
- 根據實際數據給建議，不要捏造數字
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

  const systemPrompt = buildSystemPrompt(contextPage, metricsContext)

  const claudeRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  })

  const rawText = claudeRes.content[0].type === 'text' ? claudeRes.content[0].text : ''
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  let parsed: object
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = { type: 'general', summary: cleaned, bullets: [], stats: [], actions: [] }
  }

  // Save to Firestore for Cowork memory
  await adminDb.collection('users').doc(uid).collection('aiInsights').add({
    question: message,
    response: parsed,
    contextPage,
    metricsSnapshot: metricsContext ?? null,
    createdAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ response: parsed })
}
