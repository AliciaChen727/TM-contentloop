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
  spend?: number
  roas?: number
  cpa?: number
  ctr?: number
  cpm?: number
  impressions?: number
  frequency?: number
  conversions?: number
  revenue?: number
  topCreatives?: { name: string; roas: number; spend: number; ctr: number; cpa: number }[]
}

function buildSystemPrompt(contextPage: string, metrics?: MetricsContext, memory?: string): string {
  const isPostsContext = contextPage === 'posts' || contextPage === 'combined'
  const isCreativePage = contextPage === 'creative'

  const role = isCreativePage
    ? '你是一位廣告素材生成專家，核心任務是根據用戶提供的品牌名稱、目標受眾、活動主題，立即生成高品質的廣告圖片或影片素材。遇到任何描述性資訊，優先生成，不分析、不詢問。'
    : isPostsContext
      ? '你是一位專精 Facebook 和 Instagram 社群經營的內容顧問，核心任務是協助分析貼文成效、找出高互動規律，並給出具體可執行的內容優化建議。'
      : '你是一位專精 Meta 廣告投放的資深廣告顧問，核心任務是分析廣告帳戶數據（ROAS、CPA、CTR、觸及、頻率等），診斷成效問題，並給出具體可執行的優化行動。'

  const memoryBlock = memory
    ? `\n## 過去分析記憶（請優先建立在這些結論上）\n${memory}\n`
    : ''

  let metricsBlock = ''
  if (metrics && Object.keys(metrics).length > 0) {
    if (metrics.spend !== undefined || metrics.roas !== undefined) {
      metricsBlock = `
## 廣告帳戶數據（${metrics.dateRange ?? '近期'}）
- 總花費：$${metrics.spend?.toLocaleString('zh-TW') ?? 'N/A'}　收益：$${metrics.revenue?.toLocaleString('zh-TW') ?? 'N/A'}
- ROAS：${metrics.roas?.toFixed(2) ?? 'N/A'}x　CPA：$${metrics.cpa?.toFixed(0) ?? 'N/A'}
- CTR：${metrics.ctr?.toFixed(2) ?? 'N/A'}%　CPM：$${metrics.cpm?.toFixed(0) ?? 'N/A'}
- 曝光：${metrics.impressions?.toLocaleString('zh-TW') ?? 'N/A'}　轉換：${metrics.conversions ?? 'N/A'}　頻率：${metrics.frequency?.toFixed(1) ?? 'N/A'}
${metrics.topCreatives?.length ? `
## 素材表現（前 ${metrics.topCreatives.length} 名）
${metrics.topCreatives.map((c, i) => `${i + 1}. ${c.name.slice(0, 35)} | ROAS ${c.roas.toFixed(1)}x | 花費 $${c.spend} | CTR ${c.ctr.toFixed(2)}%`).join('\n')}` : ''}`
    } else {
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
  }

  return `${role}

${isCreativePage ? `## 🎯 素材庫模式（最高優先，覆蓋以下一切規則）
當前頁面為素材庫。用戶的所有訊息都視為素材生成請求。
→ 任何非空白訊息 → 一律立即回傳 type: "image_request"
→ 若只有生成命令（如「請生成」「對」「好」）而無其他資訊，以帳戶最佳素材主題、品牌背景自動生成 imagePrompt
→ 若有品牌/受眾/主題資訊，以此為基礎撰寫 imagePrompt
→ 若有圖片附件，以圖片的視覺風格和品牌元素為基礎生成 imagePrompt（不分析圖片）
→ 禁止分析、禁止詢問、禁止要求補充
→ 若訊息含「影片」「Reels」「動態」→ 改為 type: "video_request"
→ 訊息完全空白才可 type: "general"

` : ''}## ⚡ 最高優先：生成素材請求（覆蓋以下所有規則）
若用戶訊息包含「生成」「做一張」「做一版」「製作」「出一版」「直接生成」「幫我生成」「給我一張」「做素材」「出素材」，且提到圖片/素材/廣告圖/廣告圖片（非影片）：
→ 立即回傳 type: "image_request"
→ 根據對話上下文自行撰寫英文 imagePrompt。極度重要：為了避免生成扭曲亂碼，除非用戶明確要求文字，否則必須在提示詞結尾強制加上「No text, no typography, no letters, clean background with empty space for text layout」。
→ 禁止先分析或詢問問題，直接生成
→ summary 說明生成方向（含尺寸建議如 1080x1350px）

若用戶訊息包含「將此圖用於」「用於推廣」「用於活動」「活動素材」「推廣素材」「廣告素材」「Banner」「banner」，或訊息提到「此圖」但無附件：
→ 視為「為該活動／用途生成廣告圖」請求
→ 立即回傳 type: "image_request"
→ 根據訊息中的活動名稱、目標受眾、品牌，自行撰寫英文 imagePrompt
→ 禁止詢問「圖在哪裡」或要求上傳，直接生成
→ summary 說明生成方向（含活動主題與建議尺寸如 1080x1350px）

若用戶訊息包含「影片」「Reels」「動態素材」「生成影片」「做一段」：
→ 立即回傳 type: "video_request"
→ 根據對話上下文自行撰寫英文 videoPrompt，videoDuration 預設 5
→ 禁止先分析或詢問問題，直接生成

## 行為準則
【實話實說】：直接點出問題，不過度浮誇，不捏造數字。若數據不足，明確說明「數據不足，無法判斷」。
【先分析再建議】：先理解數據脈絡（趨勢、異常、對比）再給建議，不跳過分析直接給結論。
【主動釐清】：當問題語意模糊時，在 bullets 中提出 2 個選項讓用戶選擇，例如「你想了解 A 還是 B？」。例外：（1）若用戶要求生成圖片或影片，直接生成，不得釐清；（2）若訊息含「此圖」但無附件，不得要求上傳，直接為提及的活動／用途生成廣告素材。
【正負指標明確】：正面數據（如 ROAS 達標、互動率高於均值）與負面數據（如 CPA 過高、頻率疲勞）要明確區分，不混為一談。
【建議具體可執行】：每條 actions 要有具體數字或對象，例如「將受眾 A 的日預算從 $X 提高至 $Y」，而非「考慮調整預算」。
${memoryBlock}
## 回傳格式
繁體中文。直接輸出純 JSON 物件，禁止包在 markdown code block 裡，禁止任何說明文字，只輸出 JSON：
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general" | "image_request" | "video_request",
  "summary": "一句話結論，包含最關鍵的指標數字",
  "bullets": ["重點1（含數據）", "重點2（含判斷）", "重點3", "重點4"],
  "stats": [{"label": "指標名", "value": "數值（含單位）"}],
  "actions": ["具體行動1（含對象與數字）", "具體行動2", "具體行動3"],
  "imagePrompt": "（僅在 type 為 image_request 時填入）英文圖像生成提示詞",
  "videoPrompt": "（僅在 type 為 video_request 時填入）英文影片生成提示詞",
  "videoDuration": 5
}

規則：
- summary 必須含有具體數字，不能只說「表現良好」
- bullets 最多 4 條，每條不超過 50 字，有數據的優先
- stats 最多 3 個，只挑最關鍵的指標
- actions 最多 4 條，每條都要具體到「對誰做什麼，目標是多少」
- 若數據全為 0 或缺失，type 用 "warning"，在 summary 說明資料不完整，不要硬給建議
- 當使用者詢問廣告素材、圖片、視覺設計，或說「生成」「做一張」「廣告圖」「素材」時：
  - 回傳 type: "image_request"
  - imagePrompt：英文提示詞，格式：「Professional Facebook/Instagram ad for [主題], [風格描述], vibrant colors, clean modern design, high quality. No text, no typography, no letters, clean background space for layout.」
- 當使用者詢問 Reels 影片、動態素材、影片廣告，或說「生成影片」「做一段 Reels」「影片素材」時：
  - 回傳 type: "video_request"
  - videoPrompt：英文提示詞，格式：「Vertical 9:16 short video for [主題], [視覺描述], cinematic lighting, smooth motion, professional quality」
  - videoDuration：建議秒數（1–8 整數），短 hook 用 5，完整場景用 8；若用戶未指定預設 5
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
  const { message, contextPage, metricsContext, fileAttachment } = body as {
    message: string
    contextPage: string
    metricsContext?: MetricsContext
    fileAttachment?: { type: 'image' | 'pdf' | 'text'; mimeType: string; content: string; name: string }
  }

  if (!message?.trim() && !fileAttachment) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

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

  // Build user message content (text + optional file)
  const userContent: Anthropic.MessageParam['content'] = []
  if (fileAttachment) {
    if (fileAttachment.type === 'image') {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: fileAttachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileAttachment.content } })
    } else if (fileAttachment.type === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileAttachment.content } } as any)
    } else {
      userContent.push({ type: 'text', text: `以下是上傳的檔案「${fileAttachment.name}」內容：\n\`\`\`\n${fileAttachment.content.slice(0, 8000)}\n\`\`\`` })
    }
  }
  if (message?.trim()) userContent.push({ type: 'text', text: message })

  let claudeRes
  try {
    claudeRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
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
    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      else throw new Error('no json')
    } catch {
      const shortText = cleaned.replace(/```[\s\S]*?```/g, '').trim().slice(0, 200)
      parsed = { type: 'general', summary: shortText || 'AI 回應解析失敗，請再試一次', bullets: [], stats: [], actions: [] }
    }
  }

  // Safety net: if user clearly wants image generation, enforce it regardless of page
  {
    const p = parsed as Record<string, unknown>
    const isCreative = contextPage === 'creative'
    const hasGenerationIntent = (isCreative && (!!fileAttachment || !!message?.trim()))
      || /生成|做一張|做一版|製作|出一版|幫我生|直接生|出素材|做素材|廣告素材|廣告圖/.test(message ?? '')
    if (hasGenerationIntent && p.type !== 'image_request' && p.type !== 'video_request') {
      const contextText = [p.summary as string, ...((p.bullets ?? []) as string[])].filter(Boolean).join('. ')
      p.type = 'image_request'
      if (!p.imagePrompt) {
        p.imagePrompt = `Professional Meta advertisement creative for Toastmasters District 67, ${contextText.slice(0, 200)}, vibrant gold and blue colors, clean modern design, 1080x1350px vertical format. No text, no typography, clean background.`
      }
    }
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
