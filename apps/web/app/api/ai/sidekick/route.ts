export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getUserApiKey } from '@/lib/userApiKeys'
import { resolvePageProfile } from '@/lib/page-profile'
import { getSidekickFewShot, formatFewShot } from '@/lib/sidekick/feedbackRetrieval'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'

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

interface OrgCtx { name: string; type: string; coreKpi: string; extraContext: string }

interface FeedbackRecord {
  rating: string
  response: string
  pageContext: string
  improveReason?: string
  improveNote?: string
}

const IMPROVE_REASON_LABELS: Record<string, string> = {
  too_vague: '建議太模糊，不夠具體',
  wrong_data: '數字分析不準確',
  not_relevant: '建議跟用戶狀況不符',
  other: '其他原因',
}

function buildHelpfulBlock(cases: FeedbackRecord[], lang: 'zh-TW' | 'en'): string {
  if (cases.length === 0) return ''
  if (lang === 'en') {
    return `\n## Past Diagnoses Users Found Helpful\n${cases.map((c, i) => `\nExample ${i + 1} (${c.pageContext}):\n"${c.response.slice(0, 120)}..."`).join('\n')}\n`
  }
  return `\n## 過去用戶認為有幫助的診斷範例\n${cases.map((c, i) => `\n範例 ${i + 1}（頁面：${c.pageContext}）：\n「${c.response.slice(0, 120)}...」`).join('\n')}\n`
}

function buildImproveBlock(cases: FeedbackRecord[], lang: 'zh-TW' | 'en'): string {
  if (cases.length === 0) return ''
  if (lang === 'en') {
    return `\n## Diagnosis Styles to Avoid\n${cases.map((c, i) => `\n${i + 1}. Reason: ${c.improveReason ?? 'other'}${c.improveNote ? ` — "${c.improveNote}"` : ''}\n   Example to avoid: "${c.response.slice(0, 80)}..."`).join('\n')}\n`
  }
  return `\n## 請避免以下診斷方式\n${cases.map((c, i) => `\n${i + 1}. 原因：${IMPROVE_REASON_LABELS[c.improveReason ?? ''] ?? '其他'}${c.improveNote ? `（補充：「${c.improveNote}」）` : ''}\n   避免類似這樣的回應：「${c.response.slice(0, 80)}...」`).join('\n')}\n`
}

interface ABTestResult {
  winner: string
  aiDiagnosis: string
  controlCopy?: string
  variantCopy?: string
  ctrDelta?: number
  cpaDelta?: number
}

function extractPatterns(cases: ABTestResult[], lang: 'zh-TW' | 'en'): string {
  const n = cases.length
  const avgCtr = cases.reduce((s, t) => s + (t.ctrDelta ?? 0), 0) / n
  const avgCpa = cases.reduce((s, t) => s + (t.cpaDelta ?? 0), 0) / n
  const shortWins = cases.filter(t => (t.variantCopy?.length ?? 0) < 30).length
  const qWins = cases.filter(t => /你|嗎？|是不是/.test(t.variantCopy ?? '')).length

  if (lang === 'en') {
    const lines: string[] = []
    if (avgCtr > 0) lines.push(`- AI-suggested version averaged CTR improvement: +${avgCtr.toFixed(1)}%`)
    if (avgCpa > 0) lines.push(`- AI-suggested version averaged CPA reduction: -${avgCpa.toFixed(1)}%`)
    if (shortWins > n * 0.6) lines.push(`- Short copy (under 30 chars) tends to win`)
    if (qWins > n * 0.5) lines.push(`- Question-format openings ("Are you...?") tend to win`)
    return lines.length > 0 ? lines.join('\n') : '- Insufficient cases to identify patterns yet'
  }
  const lines: string[] = []
  if (avgCtr > 0) lines.push(`- AI 建議版平均 CTR 提升 +${avgCtr.toFixed(1)}%`)
  if (avgCpa > 0) lines.push(`- AI 建議版平均 CPA 降低 -${avgCpa.toFixed(1)}%`)
  if (shortWins > n * 0.6) lines.push(`- 短文案（30 字以內）勝率較高`)
  if (qWins > n * 0.5) lines.push(`- 問句開頭（「你是不是...」「你有沒有...」）勝率較高`)
  return lines.length > 0 ? lines.join('\n') : '- 案例數量尚不足以歸納規律，持續累積測試中'
}

function buildAbTestBlock(abTestResults: ABTestResult[], lang: 'zh-TW' | 'en'): string {
  const winningCases = abTestResults.filter(t => t.winner === 'A' || t.winner === 'B')
  if (lang === 'en') {
    if (winningCases.length === 0) return `\n## A/B Test History\nNo winning AI-suggested cases recorded yet. Rely on ad data and general best practices.\n`
    return `\n## A/B Test Historical Results (prioritize these insights)\n${winningCases.map((t, i) => `\nCase ${i + 1}:\n- Control copy: "${t.controlCopy ?? 'N/A'}"\n- AI-suggested copy: "${t.variantCopy ?? 'N/A'}"\n- AI diagnosis: "${t.aiDiagnosis}"\n- Result: CTR ${t.ctrDelta != null ? (t.ctrDelta > 0 ? `+${t.ctrDelta}%` : `${t.ctrDelta}%`) : 'N/A'}, CPA ${t.cpaDelta != null ? (t.cpaDelta > 0 ? `-${t.cpaDelta}%` : `+${Math.abs(t.cpaDelta)}%`) : 'N/A'}`).join('\n')}\n\nHigh-win-rate copy patterns for this account:\n${extractPatterns(winningCases, 'en')}\n`
  }
  if (winningCases.length === 0) return `\n## A/B 測試歷史\n這個帳號目前尚無 AI 建議版勝出的測試記錄。請根據廣告成效數據與通用最佳實踐給出建議。\n`
  return `\n## A/B 測試歷史成果（請優先參考這些成功案例）\n過去 AI 建議版勝出的案例：\n${winningCases.map((t, i) => `\n案例 ${i + 1}：\n- 控制組文案：「${t.controlCopy ?? 'N/A'}」\n- AI 建議版：「${t.variantCopy ?? 'N/A'}」\n- AI 當初的診斷：「${t.aiDiagnosis}」\n- 實際結果：CTR ${t.ctrDelta != null ? (t.ctrDelta > 0 ? `+${t.ctrDelta}%` : `${t.ctrDelta}%`) : 'N/A'}，CPA ${t.cpaDelta != null ? (t.cpaDelta > 0 ? `降低 -${t.cpaDelta}%` : `上升 +${Math.abs(t.cpaDelta)}%`) : 'N/A'}`).join('\n')}\n\n根據以上案例，這個帳號的高勝率文案特徵：\n${extractPatterns(winningCases, 'zh-TW')}\n`
}

function buildSidekickSystemPrompt(contextPage: string, metrics?: MetricsContext, memory?: string, lang: 'zh-TW' | 'en' = 'zh-TW', orgCtx?: OrgCtx | null, abTestResults?: ABTestResult[], helpfulResponses?: FeedbackRecord[], improveResponses?: FeedbackRecord[]): string {
  const isPostsContext = contextPage === 'posts' || contextPage === 'combined'
  const isCreativePage = contextPage === 'creative'
  const metricsBlock = metrics && Object.keys(metrics).length > 0 ? buildMetricsBlock(metrics, lang) : ''

  const abTestBlock = abTestResults ? buildAbTestBlock(abTestResults, lang) : ''
  const helpfulBlock = helpfulResponses?.length ? buildHelpfulBlock(helpfulResponses, lang) : ''
  const improveBlock = improveResponses?.length ? buildImproveBlock(improveResponses, lang) : ''

  if (lang === 'en') {
    const role = isCreativePage
      ? 'You are an advertising expert specializing in ad creative analysis and recommendations. Only generate images when the user explicitly requests to "create", "generate", or "make" a new ad creative. Otherwise always return type: "analysis" or "recommendation".'
      : isPostsContext
        ? 'You are a social media content consultant specializing in Facebook and Instagram. Your core mission is to analyze post performance, identify high-engagement patterns, and provide specific actionable content optimization advice.'
        : orgCtx
          ? `You are a senior Meta advertising consultant. Analyze ad account data and provide specific actionable optimization recommendations.\n\n[Important Context]: This is ${orgCtx.name} (${orgCtx.type}). Core KPI: ${orgCtx.coreKpi}.${orgCtx.extraContext ? '\n' + orgCtx.extraContext : ''}`
          : 'You are a senior Meta advertising consultant. Analyze ad account data and provide specific actionable optimization recommendations.\n\n[Important Context]: This is a Toastmasters International District 67 non-profit ad account. The main goal is to drive clicks on a registration link (Google Form) for events. Since there is no revenue:\n- **ROAS is meaningless for this account** (no revenue), ROAS = 0.00x is normal\n- **Core KPI is CPL (cost per registration click)**: Spend ÷ link clicks\n- Top priority: improve CTR and lower CPL\n- Google Form cannot track form completion rate; suggest UTM parameters + GA for tracking'

    const memoryBlock = memory ? `\n## Past Analysis Memory (build on these conclusions)\n${memory}\n` : ''
    const enAbTestBlock = abTestBlock

    return `${role}

${isCreativePage ? `## 🎯 Creative Library Mode
Current page is the ad creative library. For performance analysis or diagnosis, provide professional insights (return type: "analysis" or "recommendation").
**Only return type: "image_request" when the user explicitly requests generating a new image/creative.**

` : ''}## ⚡ MUTUAL EXCLUSION RULE (HIGHEST PRIORITY — never violate)
- If type is "image_request" or "video_request":
  - bullets and actions MUST be empty arrays []
  - imagePrompt (for image_request) or videoPrompt (for video_request) MUST be filled
- If bullets or actions are used to ask clarifying questions (e.g. missing product name, target audience, ad goal):
  - type MUST be "general" or "actions"
  - imagePrompt and videoPrompt MUST be omitted entirely (do not include the field at all, not even as empty string)
  - Each action item should describe an information category to be supplied (e.g. "Provide product name or promotion topic"), not an instruction
- NEVER mix clarifying questions with imagePrompt/videoPrompt in the same response.

## 🚫 Existing Design Edit Request (highest priority, overrides all generation rules)
If the user's message meets BOTH conditions:
  A. An image is attached that appears to be a finished design (contains text, logos, portraits, event info)
  B. The message contains editing intent: "keep", "preserve", "only change", "modify the subtitle", "just replace X", "retain the original"
→ NEVER return type: "image_request"
→ Return type: "recommendation"
→ summary: explain that AI can only generate brand-new images from scratch — it CANNOT edit or modify an existing design; furthermore, ALL AI image models (Imagen, DALL-E, Stable Diffusion) cannot accurately render Chinese characters — any generated image will have garbled or incorrect Chinese text, and this cannot be fixed by prompting
→ actions must include exactly these 3 alternatives:
  1. "Open the original design in Canva (or your design tool) and edit the subtitle text directly — fastest option"
  2. "I can draft the revised subtitle/copy text for you to paste back into your design tool"
  3. "If you still want AI to generate, I can create an English-only or icon-only version; Chinese text would need to be added manually afterward"

## ⚡ Creative Generation Request
If the user message contains explicit generation verbs like "generate", "create", "make", "design" referring to images/creatives (not video) AND there is enough context to write a meaningful prompt:
→ Immediately return type: "image_request" with non-empty imagePrompt and empty bullets/actions
→ Write an English imagePrompt based on context. CRITICAL: To avoid distorted output, unless the user explicitly asks for text, always append "No text, no typography, no letters, clean background with empty space for text layout" at the end.
→ summary should explain the generation direction (include size recommendation like 1080x1350px)

If the user wants to generate but context is insufficient (no product, no audience, no goal):
→ Return type: "general" or "actions"
→ Put clarifying items in actions (e.g. "Provide product name", "Specify ad placement", "Target audience age range")
→ Do NOT include imagePrompt — wait for the user to supply details first

**Force-generate override (overrides the "insufficient context" rule)**:
If the user message contains "直接生成", "不需澄清", "不再澄清", "用預設", "就用現有資訊", "generate anyway", "force generate", "use defaults":
→ MUST generate immediately, do NOT ask for clarification again
→ Use sensible defaults based on conversation history and current page context${orgCtx ? ` (${orgCtx.name}, ${orgCtx.type}, KPI: ${orgCtx.coreKpi})` : ' (e.g. Toastmasters District 67 ad account)'}
→ ${orgCtx ? `Default scenario: ${orgCtx.name} (${orgCtx.type}), core KPI: ${orgCtx.coreKpi}; use a visual style fitting the brand` : 'Default scenario: Toastmasters non-profit recruitment / speech contest / public speaking training; visual style: professional, warm, encouraging, gold and deep blue'}
→ Return type: "image_request" or "video_request" (infer from history whether the user wants image or video)

**Note**: If the user is asking to "analyze", "diagnose", or "improve" an existing creative, do NOT return type: "image_request" — return analysis instead.

If the user message contains "video", "Reels", "motion creative", "generate video", "make a clip" AND context is sufficient:
→ Immediately return type: "video_request" with non-empty videoPrompt and empty bullets/actions
→ Write an English videoPrompt, videoDuration defaults to 5

If video generation requested but context is insufficient:
→ Return type: "general" or "actions" with clarifying items in actions
→ Do NOT include videoPrompt — wait for user to supply details first

## Behavioral Guidelines
[Honest]: Point out issues directly. Do not exaggerate or fabricate numbers. If data is insufficient, state "insufficient data, cannot determine."
[Analyze then recommend]: Understand data context (trends, anomalies, comparisons) before giving advice.
[Clarify proactively]: When the question is ambiguous, offer 2 options in bullets. Exception: (1) if user requests image/video generation, generate immediately; (2) if message mentions "this image" but no attachment, generate directly for the mentioned topic.
[Clear positive/negative signals]: Distinguish good metrics (high engagement rate, ROAS on target) from bad (high CPA, frequency fatigue).
[Specific actions]: Each action must have a specific target, e.g. "Increase audience A daily budget from $X to $Y", not "consider adjusting budget."
${memoryBlock}${helpfulBlock}${improveBlock}${enAbTestBlock}
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

## Copy A/B Test Request
When the user pastes ad copy and asks for "A/B test versions", "optimize copy", "give me variants", or similar:
→ Return type: "copy_variants" with non-empty copyVariants array and empty bullets/actions/stats
→ **Before generating, ALWAYS check in order**:
  1. "A/B Test Historical Results" block above (if present): extract winning copy patterns (e.g. emotional openings, question format, short copy under 30 chars, specific hooks that won)
  2. Top creative performance data (topCreatives CTR/CPA): infer which copy styles correlate with high performance
  3. If no historical data: default to emotional appeal + rhetorical question as the higher-win-rate direction
→ copyVariants must contain exactly 3 items:
  1. label: "Control (Original)" — copy field = original text unchanged
  2. label: "Test A" — apply the highest-win-rate pattern from history (e.g. emotional opening, question hook); rationale must cite the historical pattern used
  3. label: "Test B" — alternative angle that also draws from history (e.g. shorter copy, different emotional angle, different audience perspective)
→ rationale: one sentence citing which historical pattern was applied and why it tends to win for this account

## Response Format
Always respond in English. Output pure JSON directly — no markdown code block, no explanation text, only JSON:
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general" | "image_request" | "video_request" | "copy_variants",
  "summary": "One-sentence conclusion with the most critical metric numbers",
  "bullets": ["Key point 1 (with data)", "Key point 2 (with judgment)", "Key point 3", "Key point 4"],
  "stats": [{"label": "Metric name", "value": "Value (with unit)"}],
  "actions": ["Specific action 1 (with target and number)", "Specific action 2", "Specific action 3"],
  "imagePrompt": "(only when type is image_request) English image generation prompt",
  "videoPrompt": "(only when type is video_request) English video generation prompt",
  "videoDuration": 5,
  "copyVariants": "(only when type is copy_variants) [{\"label\": \"...\", \"copy\": \"...\", \"rationale\": \"...\"}]"
}

Rules:
- summary must include specific numbers, not just "performance is good"
- bullets max 4, each under 50 words, data-backed preferred
- stats max 3, only the most critical metrics
- actions max 4, each must specify who/what/target number
- if all data is 0 or missing, use type "warning" and explain incomplete data in summary
- For image generation: imagePrompt format: "Professional Facebook/Instagram ad for [topic], [style], vibrant colors, clean modern design, high quality. No text, no typography, no letters, clean background space for layout."
- For video generation: videoPrompt format: "Vertical 9:16 short video for [topic], [visual description], cinematic lighting, smooth motion, professional quality"
- videoDuration: recommended seconds (4–8 integer, minimum 4), 5 for short hooks, 8 for full scenes
- For copy_variants: copyVariants must have exactly 3 items; bullets/actions/stats must be empty arrays
${metricsBlock}`
  }

  // zh-TW (original)
  const role = isCreativePage
    ? '你是一位廣告專家，擅長分析廣告素材表現與提供廣告建議。只有當用戶明確要求「生成」「做一張」「製作」新廣告素材時，才生成圖片。其他情況一律回傳 type: "analysis" 或 "recommendation"。'
    : isPostsContext
      ? '你是一位專精 Facebook 和 Instagram 社群經營的內容顧問，核心任務是協助分析貼文成效、找出高互動規律，並給出具體可執行的內容優化建議。'
      : orgCtx
        ? `你是一位專精 Meta 廣告投放的資深廣告顧問。負責分析廣告帳戶數據並給出具體可執行的優化建議。\n\n《重要背景》：本帳戶是「${orgCtx.name}」（${orgCtx.type}）。核心 KPI：${orgCtx.coreKpi}。${orgCtx.extraContext ? '\n' + orgCtx.extraContext : ''}`
        : '你是一位專精 Meta 廣告投放的資深廣告顧問。負責分析廣告帳戶數據並給出具體可執行的優化建議。\n\n《重要背景》：本帳戶是 Toastmasters International District 67 的公益社團廣告帳戶。主要目標是透過臉書/IG 廣告吸引民眾點擊「報名連結」（Google Form）來參加活動。由於是公益組織、沒有金流，所以：\n- **ROAS 對此帳戶沒有意義**（沒有收益），請對 ROAS = 0.00x 不要疑惑，這是正常的\n- **核心 KPI 是 CPL（每次報名點擊成本）**：花費 ÷ 點擊報名連結的人數（以 link_click 數代替轉換數）\n- 最高優先度的優化方向：提升 CTR（讓更多人點進連結）與降低 CPL（降低每次點擊成本）\n- 目前 Google Form 無法紀錄填表完成率，若用戶詢問具體報名率，應說明此限制並建議將連結加上 UTM 參數後再透過 GA 監控'

  const memoryBlock = memory ? `\n## 過去分析記憶（請優先建立在這些結論上）\n${memory}\n` : ''

  return `${role}

${isCreativePage ? `## 🎯 素材庫模式
當前頁面為廣告素材庫。如果用戶詢問素材表現、數據分析或診斷，請給予專業的分析與建議（回傳 type: "analysis" 或 "recommendation"）。
**只有在用戶「明確要求生成新圖片/素材」時，才回傳 type: "image_request"**。

` : ''}## ⚡ 互斥規則（最高優先 — 絕對不可違反）
- 當 type 為 "image_request" 或 "video_request" 時：
  - bullets 和 actions 必須為空陣列 []
  - 必須包含對應的 imagePrompt（image_request）或 videoPrompt（video_request）
- 當 bullets 或 actions 用來「詢問澄清資訊」（如缺少產品名稱、目標受眾、廣告目標）時：
  - type 必須為 "general" 或 "actions"
  - **完全不得**包含 imagePrompt / videoPrompt 欄位（連空字串都不行，直接省略）
  - actions 條目應為「待補充的資訊類別」（如「提供產品名稱或推廣主題」），不是動作指令
- 絕對禁止在同一個回應中同時出現「澄清問題」和「imagePrompt/videoPrompt」。

## 🚫 現有設計稿修改請求（最高優先，覆蓋所有生成規則）
若用戶訊息同時符合以下兩個條件：
  A. 附有上傳的圖片，且該圖片看起來是已完成的設計稿（含有文字、Logo、人物照片、活動資訊等）
  B. 訊息包含局部編輯意圖：「保留」「只修改」「副標題改成」「只換」「改成」「維持原有」等詞彙
→ 絕對禁止回傳 type: "image_request"
→ 回傳 type: "recommendation"
→ summary 說明：AI 目前只能全新生成圖片，**無法在現有設計稿上局部修改**；此外，所有 AI 圖像模型（包含 Imagen、DALL-E、Stable Diffusion）均無法準確渲染中文字，若強制生成，中文文字將出現亂碼或錯字，且此問題無法透過調整提示詞解決
→ actions 必須給出以下三條替代建議：
  1. 「用 Canva（或你的設計工具）開啟原始設計檔，直接修改副標題文字，最快速」
  2. 「我可以幫你擬好修改後的副標題或文案，你再貼回設計工具套用」
  3. 「若仍想 AI 生成，我可以提供無中文的英文版或提示詞，中文文字需自行後製加入」

## ⚡ 生成素材請求
若用戶訊息含有「生成」「做一張」「做一版」「製作一張」「出一版」「直接生成」「幫我生成」「給我一張」「做素材」「出素材」等**生成動詞**，且提到圖片/素材/廣告圖 **且上下文資訊足夠寫出有意義的提示詞**：
→ 立即回傳 type: "image_request"，imagePrompt 必填、bullets/actions 留空
→ 撰寫英文 imagePrompt。極度重要：除非用戶明確要求文字，否則結尾必須加上「No text, no typography, no letters, clean background with empty space for text layout」
→ summary 說明生成方向（含尺寸建議如 1080x1350px）

若用戶想生成但**資訊不足**（沒提產品、沒提受眾、沒提目標）：
→ 回傳 type: "general" 或 "actions"
→ 把待澄清項目放在 actions（例：「提供產品名稱或推廣主題」「說明廣告用途」「告訴我目標受眾」）
→ **不得**包含 imagePrompt — 等使用者補充資訊後再生成

**強制生成例外（覆蓋上述「資訊不足」規則）**：
若用戶訊息含有「直接生成」「不需澄清」「不再澄清」「用預設」「就用現有資訊」等強制生成指示：
→ 必須立刻生成，**不得**再回澄清問題
→ 依照對話歷史與當前頁面 context${orgCtx ? `（${orgCtx.name}，${orgCtx.type}，KPI：${orgCtx.coreKpi}）` : '（例如 Toastmasters District 67 廣告帳戶）'}使用合理預設值
→ ${orgCtx ? `預設情境：${orgCtx.name}（${orgCtx.type}），核心 KPI：${orgCtx.coreKpi}；視覺風格配合品牌調性` : '預設情境：Toastmasters 公益社團招生 / 演講比賽 / 新人說話訓練；視覺風格：專業正式、溫暖鼓勵、黃金色與深藍色調'}
→ 回傳 type: "image_request" 或 "video_request"（看歷史對話判斷使用者要圖還是影片）

**注意**：若用戶只是「詢問」「分析」「診斷」某個廣告素材，即使訊息中出現「廣告素材」「素材」等字眼，也**禁止**回傳 type: "image_request"，應回傳分析結果。

若用戶訊息包含「影片」「Reels」「動態素材」「生成影片」「做一段」且上下文足夠：
→ 立即回傳 type: "video_request"，videoPrompt 必填、bullets/actions 留空
→ 撰寫英文 videoPrompt，videoDuration 預設 5

若影片生成但資訊不足：
→ 回傳 type: "general" 或 "actions" + 澄清條目放在 actions
→ **不得**包含 videoPrompt — 等使用者補充資訊後再生成

## 行為準則
【實話實說】：直接點出問題，不過度浮誇，不捏造數字。若數據不足，明確說明「數據不足，無法判斷」。
【先分析再建議】：先理解數據脈絡（趨勢、異常、對比）再給建議，不跳過分析直接給結論。
【主動釐清】：當問題語意模糊時，在 bullets 中提出 2 個選項讓用戶選擇，例如「你想了解 A 還是 B？」。例外：（1）若用戶要求生成圖片或影片，直接生成，不得釐清；（2）若訊息含「此圖」但無附件，不得要求上傳，直接為提及的活動／用途生成廣告素材。
【正負指標明確】：正面數據（如 ROAS 達標、互動率高於均值）與負面數據（如 CPA 過高、頻率疲勞）要明確區分，不混為一談。
【建議具體可執行】：每條 actions 要有具體數字或對象，例如「將受眾 A 的日預算從 $X 提高至 $Y」，而非「考慮調整預算」。
${memoryBlock}${helpfulBlock}${improveBlock}${abTestBlock}
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

## 文案 A/B 測試請求
當用戶貼上廣告文案並說「A/B 測試」「給我幾個版本」「優化文案」「幫我優化出測試版本」等：
→ 回傳 type: "copy_variants"，copyVariants 必填，bullets/actions/stats 均為空陣列
→ **生成前必須按順序參考**：
  1. 上方「A/B 測試歷史成果」區塊（若有）：萃取勝率高的文案特徵（如情緒開場、問句格式、短文案 30 字以內、具體贏過的 hook 寫法）
  2. 素材表現數據（topCreatives CTR/CPA）：推斷哪種文案風格對應高表現素材
  3. 若無歷史資料：以「情感訴求 + 反問式開場」為預設勝率較高的方向
→ copyVariants 必須包含 3 個項目：
  1. label: "控制組（原版）" — copy 欄位保留原文不動
  2. label: "測試版 A" — 套用歷史最高勝率規律（如情緒開場、問句 hook）；rationale 必須明確引用用的哪條歷史規律
  3. label: "測試版 B" — 同樣依據歷史，嘗試另一個高勝率角度（如不同情感切點、更短版本、不同受眾視角）
→ rationale：一句話說明「根據帳戶哪條歷史勝出規律」做了什麼改動，讓用戶看得出優化依據

## 回傳格式
繁體中文。直接輸出純 JSON 物件，禁止包在 markdown code block 裡，禁止任何說明文字，只輸出 JSON：
{
  "type": "analysis" | "recommendation" | "warning" | "actions" | "general" | "image_request" | "video_request" | "copy_variants",
  "summary": "一句話結論，包含最關鍵的指標數字",
  "bullets": ["重點1（含數據）", "重點2（含判斷）", "重點3", "重點4"],
  "stats": [{"label": "指標名", "value": "數值（含單位）"}],
  "actions": ["具體行動1（含對象與數字）", "具體行動2", "具體行動3"],
  "imagePrompt": "（僅在 type 為 image_request 時填入）英文圖像生成提示詞",
  "videoPrompt": "（僅在 type 為 video_request 時填入）英文影片生成提示詞",
  "videoDuration": 5,
  "copyVariants": "（僅在 type 為 copy_variants 時填入）[{\"label\": \"...\", \"copy\": \"...\", \"rationale\": \"...\"}]"
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
- copy_variants 時：copyVariants 必須包含 3 個物件，bullets/actions/stats 必須為空陣列
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
  const { message, contextPage, metricsContext, fileAttachments, history, pageId, language: bodyLang } = body as {
    message: string
    contextPage: string
    metricsContext?: MetricsContext
    fileAttachments?: { type: 'image' | 'pdf' | 'text' | 'video'; mimeType: string; content: string; name: string; videoUrl?: string }[]
    history?: { role: 'user' | 'assistant'; text: string }[]
    pageId?: string
    language?: 'zh-TW' | 'en'
  }

  if (!message?.trim() && (!fileAttachments || fileAttachments.length === 0)) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

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

  // Prefer the caller's key, then the page owner's shared key, then env fallback.
  // Invited viewers/editors should not need to bring their own Claude key.
  let anthropicKey = await getUserApiKey(uid, 'anthropic')
  if (!anthropicKey && pageId) {
    const ownerUid = await resolvePageOwnerUid(pageId).catch(() => null)
    if (ownerUid && ownerUid !== uid) anthropicKey = await getUserApiKey(ownerUid, 'anthropic')
  }
  anthropicKey = anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // Retrieve user language preference and organization context
  const prefSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const prefData = prefSnap.data()
  // Prefer the language the user currently has selected in the UI (sent in the
  // request); fall back to the stored preference. This guarantees the reply
  // matches what the user sees, even if the Firestore preference lags.
  const lang: 'zh-TW' | 'en' = bodyLang === 'en' || bodyLang === 'zh-TW'
    ? bodyLang
    : (prefData?.language === 'en' ? 'en' : 'zh-TW')
  const orgCtx: OrgCtx | null = prefData?.organizationContext ?? null

  // Profile resolution: page-level override → user-level onboarding fallback.
  // Lets one admin manage multiple pages across different industries.
  const profile = await resolvePageProfile(uid, pageId)

  let abTestResults: ABTestResult[] | undefined
  if (pageId) {
    try {
      const abSnap = await adminDb.collection('pages').doc(pageId)
        .collection('abTests')
        .where('winner', 'in', ['A', 'B'])
        .limit(10)
        .get()
      abTestResults = abSnap.docs.map(d => {
        const d2 = d.data()
        return { winner: d2.winner, aiDiagnosis: d2.aiDiagnosis ?? '', controlCopy: d2.controlCopy, variantCopy: d2.variantCopy, ctrDelta: d2.ctrDelta, cpaDelta: d2.cpaDelta }
      })
    } catch { abTestResults = [] }
  }

  let helpfulResponses: FeedbackRecord[] = []
  let improveResponses: FeedbackRecord[] = []
  try {
    const [helpfulSnap, improveSnap] = await Promise.all([
      adminDb.collection('users').doc(uid).collection('sidekickFeedback')
        .where('rating', '==', 'helpful').where('pageContext', '==', contextPage).limit(3).get(),
      adminDb.collection('users').doc(uid).collection('sidekickFeedback')
        .where('rating', '==', 'improve').where('pageContext', '==', contextPage).limit(3).get(),
    ])
    helpfulResponses = helpfulSnap.docs.map(d => d.data() as FeedbackRecord)
    improveResponses = improveSnap.docs.map(d => d.data() as FeedbackRecord).filter(d => !!d.improveReason)
  } catch { /* non-critical */ }

  // Prefer the merged profile (brand+industry+goal+context) for the persona block.
  // Fall back to legacy organizationContext for users who only filled the old card.
  const effectiveOrgCtx: OrgCtx | null = (profile.brandName || profile.industry)
    ? {
        name: profile.brandName ?? orgCtx?.name ?? '',
        type: profile.industry === 'other' && profile.industryOther
          ? profile.industryOther
          : (profile.industry
              ? ({ ecommerce: '電商 / 零售', education: '課程 / 教育訓練', event: '活動 / 社群組織', personal_brand: '個人品牌 / 自媒體', other: '其他' }[profile.industry])
              : (orgCtx?.type ?? '')),
        coreKpi: orgCtx?.coreKpi ?? '',
        extraContext: profile.extraContext ?? orgCtx?.extraContext ?? '',
      }
    : orgCtx

  let systemPrompt = buildSidekickSystemPrompt(contextPage, metricsContext, memory || undefined, lang, effectiveOrgCtx, abTestResults, helpfulResponses, improveResponses)

  if (profile.industry || profile.optimizationGoal || profile.brandName || profile.extraContext) {
    const industryLabelMap: Record<string, { zh: string; en: string }> = {
      ecommerce: { zh: '電商 / 零售', en: 'E-commerce / Retail' },
      education: { zh: '課程 / 教育訓練', en: 'Education / Training' },
      event: { zh: '活動 / 社群組織', en: 'Events / Community' },
      personal_brand: { zh: '個人品牌 / 自媒體', en: 'Personal brand / Media' },
      other: { zh: '其他', en: 'Other' },
    }
    const goalLabelMap: Record<string, { zh: string; en: string }> = {
      clicks: { zh: '提升點擊率（CTR / CPC / 連結點擊）', en: 'increase click-through (CTR / CPC / link clicks)' },
      conversion: { zh: '提升轉換與 ROI（ROAS / CPA / 轉換數）', en: 'improve conversion & ROI (ROAS / CPA / conversions)' },
      reach: { zh: '擴大品牌觸及（CPM / 觸及 / 曝光）', en: 'expand brand reach (CPM / reach / impressions)' },
      event: { zh: '活動報名推廣（CTR / CPL / 連結頁面瀏覽）', en: 'event registration (CTR / CPL / link page views)' },
    }
    // industryOther wins over the generic "Other" label
    const indZh = profile.industry === 'other' && profile.industryOther?.trim()
      ? profile.industryOther.trim()
      : profile.industry ? industryLabelMap[profile.industry].zh : null
    const indEn = profile.industry === 'other' && profile.industryOther?.trim()
      ? profile.industryOther.trim()
      : profile.industry ? industryLabelMap[profile.industry].en : null
    const goalZh = profile.optimizationGoal ? goalLabelMap[profile.optimizationGoal].zh : null
    const goalEn = profile.optimizationGoal ? goalLabelMap[profile.optimizationGoal].en : null
    const sourceTag = profile.source === 'page' ? '（粉專層級設定 / page-level）' : '（使用者預設 / user default）'

    const lines: string[] = []
    if (lang === 'en') {
      if (profile.brandName) lines.push(`- Brand / org: ${profile.brandName}`)
      if (indEn) lines.push(`- Industry: ${indEn}`)
      if (goalEn) lines.push(`- Primary goal: ${goalEn}`)
      if (profile.extraContext) lines.push(`- Notes: ${profile.extraContext}`)
      systemPrompt = systemPrompt +
        `\n\n[Profile ${profile.source === 'page' ? '(page-level)' : '(user default)'}]\n${lines.join('\n')}\nUse this profile to make recommendations more precise and tailor diagnostic priorities accordingly.`
    } else {
      if (profile.brandName) lines.push(`- 品牌 / 組織：${profile.brandName}`)
      if (indZh) lines.push(`- 產業：${indZh}`)
      if (goalZh) lines.push(`- 最在乎的目標：${goalZh}`)
      if (profile.extraContext) lines.push(`- 補充：${profile.extraContext}`)
      systemPrompt = systemPrompt +
        `\n\n《使用者背景 ${sourceTag}》\n${lines.join('\n')}\n請根據此背景給出更精準的診斷建議，並依此目標決定優先建議的指標。`
    }
  }

  // Page-level retrieval-augmented few-shot (Phase 3 self-learning): proven past
  // Sidekick replies for this page + context, ranked by adoption then eval score.
  if (pageId) {
    try {
      const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(uid, 'gemini'))
      const fewShot = formatFewShot(
        await getSidekickFewShot(pageId, message ?? '', { goal: profile.optimizationGoal ?? null, alertType: contextPage }, geminiKey),
      )
      if (fewShot) systemPrompt = `${systemPrompt}\n\n${fewShot}`
    } catch { /* retrieval is best-effort */ }
  }

  // Build user message content (text + optional files)
  const userContent: Anthropic.MessageParam['content'] = []
  for (const att of fileAttachments ?? []) {
    if (att.type === 'image') {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: att.content } })
    } else if (att.type === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.content } } as any)
    } else if (att.type === 'video') {
      // Claude API does not support video content blocks — pass as text reference
      userContent.push({ type: 'text', text: `使用者上傳了影片「${att.name}」${att.videoUrl ? `（${att.videoUrl}）` : ''}。Claude 目前無法直接分析影片畫面，請根據使用者的問題提供建議，若需要影片細節，請告知使用者以文字描述影片主題或畫面內容。` })
    } else if (att.type === 'text') {
      userContent.push({ type: 'text', text: `以下是上傳的檔案「${att.name}」內容：\n\`\`\`\n${att.content.slice(0, 8000)}\n\`\`\`` })
    }
  }
  if (message?.trim()) userContent.push({ type: 'text', text: message })

  // Build multi-turn message array with conversation history
  const claudeMessages: Anthropic.MessageParam[] = []
  if (history && history.length > 0) {
    for (const h of history) {
      claudeMessages.push({ role: h.role, content: h.text })
    }
  }
  claudeMessages.push({ role: 'user', content: userContent })

  let claudeRes
  try {
    claudeRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('overloaded_error') || msg.includes('529')) {
      return NextResponse.json({ error: 'AI 服務目前繁忙，請稍後 30 秒再試。' }, { status: 503 })
    }
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

  // Defensive strip: enforce mutual exclusion between clarification and generation
  {
    const p = parsed as Record<string, unknown>
    if (p.type !== 'image_request') delete p.imagePrompt
    if (p.type !== 'video_request') { delete p.videoPrompt; delete p.videoDuration }
    if (p.type !== 'copy_variants') delete p.copyVariants
    if (p.type === 'image_request' || p.type === 'video_request' || p.type === 'copy_variants') {
      p.bullets = []
      p.actions = []
      p.stats = []
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

  try {
    const inputTokens = claudeRes.usage.input_tokens
    const outputTokens = claudeRes.usage.output_tokens
    const claudeCostUsd = (inputTokens * 0.80 + outputTokens * 4) / 1_000_000
    const month = new Date().toISOString().slice(0, 7)
    await adminDb.collection('users').doc(uid).collection('usage').doc(month).set({
      claudeInputTokens: FieldValue.increment(inputTokens),
      claudeOutputTokens: FieldValue.increment(outputTokens),
      claudeCostUsd: FieldValue.increment(claudeCostUsd),
    }, { merge: true })
  } catch { /* non-critical */ }

  return NextResponse.json({ response: parsed })
}
