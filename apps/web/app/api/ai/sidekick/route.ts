export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getUserApiKey } from '@/lib/userApiKeys'

interface MetricsContext {
  // Posts metrics
  totalPosts?: number
  totalReach?: number
  totalLikes?: number
  totalComments?: number
  totalShares?: number
  avgEngRate?: number
  reelsCount?: number
  dateRange?: string
  topPosts?: { title: string; reach: number; likes: number; engRate: number; platform: string }[]
  // Ads metrics
  spend?: number
  roas?: number
  cpa?: number          // Cost per conversion (link click as proxy for registration)
  ctr?: number
  cpm?: number
  impressions?: number
  frequency?: number
  conversions?: number  // Link clicks treated as conversion proxy
  revenue?: number
  topCreatives?: { name: string; roas: number; spend: number; ctr: number; cpa: number }[]
  // GA metrics (reserved — not yet connected, will be populated when GA is integrated)
  ga?: {
    sessions?: number           // Total sessions from GA
    formPageViews?: number      // Views of registration/form page
    formClicks?: number         // Clicks on form submit (Goal completions)
    bounceRate?: number         // Bounce rate %
    avgSessionDuration?: number // Avg session duration in seconds
    organicSessions?: number    // Sessions from organic search
    paidSessions?: number       // Sessions from paid ads (utm_medium=paid)
    topLandingPages?: { page: string; sessions: number; bounceRate: number }[]
    connected: boolean          // Whether GA is actually connected
  }
}

function buildMetricsBlock(metrics: MetricsContext, lang: 'zh-TW' | 'en'): string {
  const isAds = metrics.spend !== undefined || metrics.roas !== undefined || (metrics.topCreatives?.length ?? 0) > 0
  if (lang === 'en') {
    if (isAds) {
      return `
## Ad Account Data (${metrics.dateRange ?? 'Recent'})
- Total Spend: $${metrics.spend?.toLocaleString() ?? 'N/A'}  Revenue: $${metrics.revenue?.toLocaleString() ?? 'N/A'}
- Account ROAS: ${metrics.roas != null ? metrics.roas.toFixed(2) : 'N/A'}x (0.00x means no purchase conversion detected — normal for this account)
- CPA: $${metrics.cpa != null ? metrics.cpa.toFixed(0) : 'N/A'}  CTR: ${metrics.ctr != null ? metrics.ctr.toFixed(2) : 'N/A'}%  CPM: $${metrics.cpm != null ? metrics.cpm.toFixed(0) : 'N/A'}
- Impressions: ${metrics.impressions?.toLocaleString() ?? 'N/A'}  Conversions: ${metrics.conversions ?? 'N/A'}  Frequency: ${metrics.frequency?.toFixed(1) ?? 'N/A'}
${metrics.topCreatives?.length ? `
## Creative Performance (Top ${metrics.topCreatives.length})
${metrics.topCreatives.map((c, i) => `${i + 1}. ${c.name.slice(0, 35)} | ROAS ${c.roas.toFixed(1)}x | Spend $${c.spend} | CTR ${c.ctr.toFixed(2)}% | CPA $${c.cpa.toFixed(0)}`).join('\n')}` : ''}`
    } else {
      return `
## Current Post Data (${metrics.dateRange ?? 'Recent'})
- Total Posts: ${metrics.totalPosts ?? 'N/A'} (Reels: ${metrics.reelsCount ?? 'N/A'})
- Total Reach: ${metrics.totalReach?.toLocaleString() ?? 'N/A'}
- Total Likes: ${metrics.totalLikes?.toLocaleString() ?? 'N/A'}
- Comments: ${metrics.totalComments?.toLocaleString() ?? 'N/A'}
- Shares: ${metrics.totalShares?.toLocaleString() ?? 'N/A'}
- Avg Engagement Rate: ${metrics.avgEngRate?.toFixed(2) ?? 'N/A'}%
${metrics.topPosts?.length ? `
## Recent Post Performance
${metrics.topPosts.map((p, i) => `${i + 1}. [${p.platform}] ${p.title.slice(0, 40)}... | Reach ${p.reach} | Likes ${p.likes} | Eng Rate ${p.engRate}%`).join('\n')}` : ''}`
    }
  }
  // zh-TW
  if (isAds) {
    return `
## 廣告帳戶數據（${metrics.dateRange ?? '近期'}）
- 總花費：$${metrics.spend?.toLocaleString('zh-TW') ?? 'N/A'}　收益：$${metrics.revenue?.toLocaleString('zh-TW') ?? 'N/A'}
- 帳戶整高 ROAS：${metrics.roas != null ? metrics.roas.toFixed(2) : 'N/A'}x（若為 0.00x 表示未偵測到購買轉換、以影片觀看計算，請參考個別素材的 ROAS）
- CPA：$${metrics.cpa != null ? metrics.cpa.toFixed(0) : 'N/A'}　CTR：${metrics.ctr != null ? metrics.ctr.toFixed(2) : 'N/A'}%　CPM：$${metrics.cpm != null ? metrics.cpm.toFixed(0) : 'N/A'}
- 曝光：${metrics.impressions?.toLocaleString('zh-TW') ?? 'N/A'}　轉換：${metrics.conversions ?? 'N/A'}　頻率：${metrics.frequency?.toFixed(1) ?? 'N/A'}
${metrics.topCreatives?.length ? `
## 素材表現（前 ${metrics.topCreatives.length} 名）
${metrics.topCreatives.map((c, i) => `${i + 1}. ${c.name.slice(0, 35)} | ROAS ${c.roas.toFixed(1)}x | 花費 $${c.spend} | CTR ${c.ctr.toFixed(2)}% | CPA $${c.cpa.toFixed(0)}`).join('\n')}` : ''}`
  }
  return `
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

function buildSystemPrompt(contextPage: string, metrics?: MetricsContext, memory?: string, lang: 'zh-TW' | 'en' = 'zh-TW'): string {
  const isPostsContext = contextPage === 'posts' || contextPage === 'combined'
  const isCreativePage = contextPage === 'creative'
  const metricsBlock = metrics && Object.keys(metrics).length > 0 ? buildMetricsBlock(metrics, lang) : ''

  if (lang === 'en') {
    const role = isCreativePage
      ? 'You are an advertising expert specializing in ad creative analysis and recommendations. Only generate images when the user explicitly requests to "create", "generate", or "make" a new ad creative. Otherwise always return type: "analysis" or "recommendation".'
      : isPostsContext
        ? 'You are a social media content consultant specializing in Facebook and Instagram. Your core mission is to analyze post performance, identify high-engagement patterns, and provide specific actionable content optimization advice.'
        : 'You are a senior Meta advertising consultant. Analyze ad account data and provide specific actionable optimization recommendations.\n\n[Important Context]: This is a Toastmasters International District 67 non-profit ad account. The main goal is to drive clicks on a registration link (Google Form) for events. Since there is no revenue:\n- **ROAS is meaningless for this account** (no revenue), ROAS = 0.00x is normal\n- **Core KPI is CPL (cost per registration click)**: Spend ÷ link clicks\n- Top priority: improve CTR and lower CPL\n- Google Form cannot track form completion rate; suggest UTM parameters + GA for tracking'

    const memoryBlock = memory ? `\n## Past Analysis Memory (build on these conclusions)\n${memory}\n` : ''

    return `${role}

${isCreativePage ? `## 🎯 Creative Library Mode
Current page is the ad creative library. For performance analysis or diagnosis, provide professional insights (return type: "analysis" or "recommendation").
**Only return type: "image_request" when the user explicitly requests generating a new image/creative.**

` : ''}## ⚡ Highest Priority: Creative Generation Request (overrides all rules below)
If the user message contains explicit generation verbs like "generate", "create", "make", "design" referring to images/creatives (not video):
→ Immediately return type: "image_request"
→ Write an English imagePrompt based on context. CRITICAL: To avoid distorted output, unless the user explicitly asks for text, always append "No text, no typography, no letters, clean background with empty space for text layout" at the end.
→ Do NOT analyze or ask questions first — generate directly
→ summary should explain the generation direction (include size recommendation like 1080x1350px)

**Note**: If the user is asking to "analyze", "diagnose", or "improve" an existing creative, do NOT return type: "image_request" — return analysis instead.

If the user message contains "video", "Reels", "motion creative", "generate video", "make a clip":
→ Immediately return type: "video_request"
→ Write an English videoPrompt, videoDuration defaults to 5
→ Do NOT analyze or ask questions first — generate directly

## Behavioral Guidelines
[Honest]: Point out issues directly. Do not exaggerate or fabricate numbers. If data is insufficient, state "insufficient data, cannot determine."
[Analyze then recommend]: Understand data context (trends, anomalies, comparisons) before giving advice.
[Clarify proactively]: When the question is ambiguous, offer 2 options in bullets. Exception: (1) if user requests image/video generation, generate immediately; (2) if message mentions "this image" but no attachment, generate directly for the mentioned topic.
[Clear positive/negative signals]: Distinguish good metrics (high engagement rate, ROAS on target) from bad (high CPA, frequency fatigue).
[Specific actions]: Each action must have a specific target, e.g. "Increase audience A daily budget from $X to $Y", not "consider adjusting budget."
${memoryBlock}
## Audience Analysis Safeguard
**Meta Graph API does not provide audience age/gender/interest breakdowns** (restricted by Meta privacy policy).
- When users ask about audience demographics, explain this data is unavailable and suggest checking Meta Ads Manager's Audience Insights.
- When conversions < 50 and users ask about "audience characteristics", "Lookalike", or "audience expansion": guide them to (1) verify Pixel tracking, (2) check conversion funnel, (3) accumulate at least 50 conversions before audience testing.

## Useful Tool Links (include markdown links when these tools are mentioned)
- Meta Pixel Helper: [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc)
- Events Manager: [Events Manager](https://business.facebook.com/events_manager2)
- Meta Ads Manager: [Ads Manager](https://adsmanager.facebook.com/)
- Meta Business Manager: [Business Manager](https://business.facebook.com/)
- Meta Audience Insights: [Audience Insights](https://business.facebook.com/audience-insights)
- Meta Blueprint: [Meta Blueprint](https://www.facebook.com/business/learn)

## Response Format
Always respond in English. Output pure JSON directly — no markdown code block, no explanation text, only JSON:
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general" | "image_request" | "video_request",
  "summary": "One-sentence conclusion with the most critical metric numbers",
  "bullets": ["Key point 1 (with data)", "Key point 2 (with judgment)", "Key point 3", "Key point 4"],
  "stats": [{"label": "Metric name", "value": "Value (with unit)"}],
  "actions": ["Specific action 1 (with target and number)", "Specific action 2", "Specific action 3"],
  "imagePrompt": "(only when type is image_request) English image generation prompt",
  "videoPrompt": "(only when type is video_request) English video generation prompt",
  "videoDuration": 5
}

Rules:
- summary must include specific numbers, not just "performance is good"
- bullets max 4, each under 50 words, data-backed preferred
- stats max 3, only the most critical metrics
- actions max 4, each must specify who/what/target number
- if all data is 0 or missing, use type "warning" and explain incomplete data in summary
- For image generation: imagePrompt format: "Professional Facebook/Instagram ad for [topic], [style], vibrant colors, clean modern design, high quality. No text, no typography, no letters, clean background space for layout."
- For video generation: videoPrompt format: "Vertical 9:16 short video for [topic], [visual description], cinematic lighting, smooth motion, professional quality"
- videoDuration: recommended seconds (1–8 integer), 5 for short hooks, 8 for full scenes
${metricsBlock}`
  }

  // zh-TW (original)
  const role = isCreativePage
    ? '你是一位廣告專家，擅長分析廣告素材表現與提供廣告建議。只有當用戶明確要求「生成」「做一張」「製作」新廣告素材時，才生成圖片。其他情況一律回傳 type: "analysis" 或 "recommendation"。'
    : isPostsContext
      ? '你是一位專精 Facebook 和 Instagram 社群經營的內容顧問，核心任務是協助分析貼文成效、找出高互動規律，並給出具體可執行的內容優化建議。'
      : '你是一位專精 Meta 廣告投放的資深廣告顧問。負責分析廣告帳戶數據並給出具體可執行的優化建議。\n\n《重要背景》：本帳戶是 Toastmasters International District 67 的公益社團廣告帳戶。主要目標是透過臉書/IG 廣告吸引民眾點擊「報名連結」（Google Form）來參加活動。由於是公益組織、沒有金流，所以：\n- **ROAS 對此帳戶沒有意義**（沒有收益），請對 ROAS = 0.00x 不要疑惑，這是正常的\n- **核心 KPI 是 CPL（每次報名點擊成本）**：花費 ÷ 點擊報名連結的人數（以 link_click 數代替轉換數）\n- 最高優先度的優化方向：提升 CTR（讓更多人點進連結）與降低 CPL（降低每次點擊成本）\n- 目前 Google Form 無法紀錄填表完成率，若用戶詢問具體報名率，應說明此限制並建議將連結加上 UTM 參數後再透過 GA 監控'

  const memoryBlock = memory ? `\n## 過去分析記憶（請優先建立在這些結論上）\n${memory}\n` : ''

  return `${role}

${isCreativePage ? `## 🎯 素材庫模式
當前頁面為廣告素材庫。如果用戶詢問素材表現、數據分析或診斷，請給予專業的分析與建議（回傳 type: "analysis" 或 "recommendation"）。
**只有在用戶「明確要求生成新圖片/素材」時，才回傳 type: "image_request"**。

` : ''}## ⚡ 最高優先：生成素材請求（覆蓋以下所有規則）
若用戶訊息含有明確的「生成」「做一張」「做一版」「製作一張」「出一版」「直接生成」「幫我生成」「給我一張」「做素材」「出素材」等**生成動詞**，且提到圖片/素材/廣告圖/廣告圖片（非影片）：
→ 立即回傳 type: "image_request"
→ 根據對話上下文自行撰寫英文 imagePrompt。極度重要：為了避免生成扭曲亂碼，除非用戶明確要求文字，否則必須在提示詞結尾強制加上「No text, no typography, no letters, clean background with empty space for text layout」。
→ 禁止先分析或詢問問題，直接生成
→ summary 說明生成方向（含尺寸建議如 1080x1350px）

**注意**：若用戶只是「詢問」「分析」「診斷」某個廣告素材，即使訊息中出現「廣告素材」「素材」等字眼，也**禁止**回傳 type: "image_request"，應回傳分析結果。

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
## 受眾分析防傑機制
**Meta Graph API 目前無法提供受眾年齡/性別/興趣分布**（Meta 已因隐私政策限制此屬性）。
- 關鍵規則：**當用戶問詢受眾年齡/性別/地區/興趣特徵分析時**，应說明目前系統無法取得此資料，建議用戶參考 Meta Ads Manager 的「受眾洞察」報表。
- 機制：當 conversions < 50 時，當用戶詢問「受眾特徵」「Lookalike」「擴展受眾」等話題，**禁止直接分析受眾特徵**，應轉向引導如下：
  1. 先確認 Pixel 追蹤是否正常（检查 「Pixel 助手」 / Events Manager）
  2. 檢查轉換漏斗設計（廣告點擊 → 起始頁 → 表單 → 購買）
  3. 累積至少 50 筆轉換再開始受眾测試，否則誊數偏差大、結論不可靠
## 常用工具連結（提到這些工具時，請在 summary 或 bullets 裡附上 markdown 連結）
- Meta Pixel Helper（Chrome 擴充功能）：[Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc)
- Events Manager（檢查 Pixel 事件）：[Events Manager](https://business.facebook.com/events_manager2)
- Meta Ads Manager（廣告管理）：[Ads Manager](https://adsmanager.facebook.com/)
- Meta Business Manager：[Business Manager](https://business.facebook.com/)
- Meta Audience Insights：[Audience Insights](https://business.facebook.com/audience-insights)
- Meta Blueprint（廣告學習）：[Meta Blueprint](https://www.facebook.com/business/learn)

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
- 當使用者明確說「生成」「做一張」「幫我做一張廣告圖」「出一張素材」等生成動詞，且指的是圖片時：
  - 回傳 type: "image_request"
  - imagePrompt：英文提示詞，格式：「Professional Facebook/Instagram ad for [主題], [風格描述], vibrant colors, clean modern design, high quality. No text, no typography, no letters, clean background space for layout.」
- **注意**：若用戶問的是「分析」「診斷」「改善」「建議」某個廣告素材，即使訊息中出現「素材」「廣告」等字眼，也不能回傳 type: "image_request"，應回傳分析結果（type: "analysis" 或 "recommendation"）。
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

  // Retrieve user's own Claude API key (required — no fallback to owner key)
  const anthropicKey = await getUserApiKey(uid, 'anthropic')
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // Retrieve user language preference
  const prefSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const lang: 'zh-TW' | 'en' = prefSnap.data()?.language === 'en' ? 'en' : 'zh-TW'

  const systemPrompt = buildSystemPrompt(contextPage, metricsContext, memory || undefined, lang)

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
    const hasGenerationIntent = /生圖|生成.*圖|生成.*素材|做一張|做一版|製作.*圖|出一版|幫我生|直接生|出素材|做素材/.test(message ?? '')
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
