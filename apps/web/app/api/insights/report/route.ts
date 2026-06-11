export const dynamic = 'force-dynamic'
export const maxDuration = 120
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth } from '@/lib/firebase/admin'
import { getUserApiKey } from '@/lib/userApiKeys'

const SYSTEM_PROMPT = `你是一位社群媒體數據分析師，為各產業的社群／品牌經營者提供洞察報告。
請根據提供的數據，用繁體中文撰寫一份簡潔有力的月度洞察報告。
分析時請以「產業 Benchmark」欄位所標示的產業為比較基準（不要預設為非營利組織）。

【JSON 格式規範 - 嚴格遵守】
1. 只輸出純 JSON，不要有任何 markdown、code fence 或多餘文字
2. 所有字串值不得包含換行符（用空格代替）
3. 所有字串值不得包含未跳脫的雙引號
4. postSnippet 只寫 15 字以內的純文字摘要，不要複製原始貼文
5. 每個字串值寫在同一行，不要換行

輸出結構：
{"executiveSummary":"3-4句摘要","topPostAnalysis":[{"postSnippet":"15字摘要","engRate":數字,"whyItWorked":"原因","replicablePattern":"模式"}],"underPerformerAnalysis":[{"postSnippet":"15字摘要","engRate":數字,"issue":"問題","improvement":"建議"}],"topAdAnalysis":[{"adSnippet":"15字摘要","ctr":數字,"whyItWorked":"成效好的原因","replicablePattern":"可複製模式"}],"underAdAnalysis":[{"adSnippet":"15字摘要","ctr":數字,"issue":"問題","improvement":"建議"}],"abTestInsight":"2-3句A/B測試洞察（若有A/B數據則結合，無則寫空字串）","benchmarkInsight":"2-3句同業比較","topRecommendations":["建議1","建議2","建議3"]}

【廣告分析規則】
- topAdAnalysis/underAdAnalysis 針對「廣告素材」（不是有機貼文），用 CTR 衡量
- 若只提供 1 則廣告：topAdAnalysis 放該廣告的完整分析（成效、原因、可優化方向都寫在 whyItWorked/replicablePattern），underAdAnalysis 回傳 []
- 若無廣告數據，topAdAnalysis/underAdAnalysis 都回傳空陣列 []

【A/B 測試分析規則（abTestInsight）— 很重要】
每個實驗的 variants 陣列有各變體實際數據（variant 名稱、ctr、impressions、spend、linkClicks、cpa）。請：
1. 明確指出勝出變體 vs 控制組的「具體數據對比」，例如「A 組 CTR 4.2% vs 控制組 2.1%，高出 100%」。一定要寫出雙方的實際數字。
2. 解釋勝出的可能原因（從素材/文案角度推論）。
3. 若 winner 為 pending：說明這可能是因為兩組投放期間或曝光量差異大（看 impressions/spend 差距）導致數據量不足、尚未達統計顯著性，所以系統標為 pending。但仍要「觀察方向性差異」——即使期間不同，仍可指出目前 A 組與控制組的 CTR/CPA 表現差異與初步趨勢，並建議延長觀察或拉齊投放條件後再定奪。
4. 若完全沒有 variants 數據才寫籠統說明；abTestInsight 無 A/B 數據時寫 ""。

【同業比較規則（benchmarkInsight）】
- 以「產業 Benchmark」標示的產業為準解讀互動率與廣告成效，明確指出高於或低於該產業常見水準。
- 若產業為自由填寫的其他產業（非預設類別），請運用你對「該特定產業」常見社群互動率與廣告 CTR/CPC 水準的知識，給出貼近該產業的同業比較，不要套用非營利組織的數字。
- 若標示為「未設定」，請在 benchmarkInsight 提醒使用者到設定填寫產業類別以取得更準確的比較。`

const SYSTEM_PROMPT_EN = `You are a social-media data analyst producing insight reports for social/brand managers across industries.
Based on the provided data, write a concise, high-impact monthly insight report IN ENGLISH.
Use the industry named in the "產業 Benchmark / Industry Benchmark" field as the comparison baseline (do NOT default to nonprofit).

[JSON FORMAT — STRICT]
1. Output ONLY pure JSON — no markdown, no code fence, no extra text
2. No newline characters inside any string value (use spaces)
3. No unescaped double quotes inside string values
4. postSnippet/adSnippet must be a plain-text summary of ~6 words or fewer; do NOT copy the original post
5. Write each string value on a single line

Output structure (KEYS MUST STAY EXACTLY AS SHOWN; only the VALUES are in English):
{"executiveSummary":"3-4 sentence summary","topPostAnalysis":[{"postSnippet":"short summary","engRate":number,"whyItWorked":"reason","replicablePattern":"pattern"}],"underPerformerAnalysis":[{"postSnippet":"short summary","engRate":number,"issue":"issue","improvement":"suggestion"}],"topAdAnalysis":[{"adSnippet":"short summary","ctr":number,"whyItWorked":"why it worked","replicablePattern":"replicable pattern"}],"underAdAnalysis":[{"adSnippet":"short summary","ctr":number,"issue":"issue","improvement":"suggestion"}],"abTestInsight":"2-3 sentence A/B insight (combine if A/B data exists, else empty string)","benchmarkInsight":"2-3 sentence peer comparison","topRecommendations":["rec 1","rec 2","rec 3"]}

[AD ANALYSIS RULES]
- topAdAnalysis/underAdAnalysis cover AD CREATIVES (not organic posts), measured by CTR
- If only 1 ad is provided: put its full analysis in topAdAnalysis (performance, reasons, optimization all in whyItWorked/replicablePattern), and return [] for underAdAnalysis
- If there is no ad data, return [] for both topAdAnalysis and underAdAnalysis

[A/B TEST RULES (abTestInsight) — IMPORTANT]
Each experiment's variants array has real per-variant data (variant name, ctr, impressions, spend, linkClicks, cpa). You must:
1. State the SPECIFIC data comparison of winner vs control, e.g. "Variant A CTR 4.2% vs control 2.1%, +100%". Always write both sides' real numbers.
2. Explain the likely reason it won (from a creative/copy angle).
3. If winner is "pending": explain it is likely because the two groups had very different run periods or impression volumes (see the impressions/spend gap), so the data is insufficient and not yet statistically significant. Still note the DIRECTIONAL difference — point out the current CTR/CPA gap and early trend, and recommend extending observation or aligning delivery conditions before deciding.
4. Only write a generic note if there are no variants at all; write "" for abTestInsight when there is no A/B data.

[PEER COMPARISON RULES (benchmarkInsight)]
- Interpret engagement and ad performance against the industry named in the Industry Benchmark field, clearly stating whether it is above or below that industry's typical level.
- If the industry is a free-text custom one (not a preset category), use your knowledge of THAT specific industry's typical social engagement rate and ad CTR/CPC levels; do not apply nonprofit numbers.
- If marked "not set", remind the user in benchmarkInsight to set their industry category in Settings for a more accurate comparison.`

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { summary, language } = await req.json() as { summary: Record<string, unknown>; language?: string }
  if (!summary) return NextResponse.json({ error: 'Missing summary' }, { status: 400 })
  const en = language === 'en'

  // Sanitize post messages before sending to Claude
  function sanitizePost(p: Record<string, unknown>) {
    return { ...p, message: String(p.message ?? '').replace(/[\r\n"]/g, ' ').slice(0, 80) }
  }
  const topPosts = (Array.isArray(summary.topPosts) ? summary.topPosts as Record<string, unknown>[] : []).map(sanitizePost)
  const underPosts = (Array.isArray(summary.underPosts) ? summary.underPosts as Record<string, unknown>[] : []).map(sanitizePost)

  const apiKey = await getUserApiKey(uid, 'anthropic') ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY' }, { status: 402 })

  const anthropic = new Anthropic({ apiKey })

  const ov = summary.overview as Record<string, unknown>
  const ads = summary.adsSummary as Record<string, unknown>
  const bc = (summary.benchmarkCompare as { fb?: Record<string, { benchmark?: number }> } | undefined)?.fb
  const erBench = bc?.engagementRate?.benchmark
  const ctrBench = bc?.adCtr?.benchmark

  // Sanitize ad records (strip newlines/quotes from names) before sending
  function sanitizeAd(a: Record<string, unknown>) {
    return { ...a, name: String(a.name ?? '').replace(/[\r\n"]/g, ' ').slice(0, 60) }
  }
  const topAds = (Array.isArray(summary.topAds) ? summary.topAds as Record<string, unknown>[] : []).map(sanitizeAd)
  const underAds = (Array.isArray(summary.underAds) ? summary.underAds as Record<string, unknown>[] : []).map(sanitizeAd)
  const abTest = (summary.abTest ?? {}) as Record<string, unknown>
  const hasAbTest = !!summary.hasAbTest

  const abSection = hasAbTest
    ? `\n\n【A/B 測試數據】\n- 實驗名稱：${abTest.experimentName || '（未命名）'}\n- 勝出版本：${abTest.winner}\n- AI 診斷：${String(abTest.aiDiagnosis ?? '').replace(/[\r\n"]/g, ' ')}\n- 實驗清單：${JSON.stringify(abTest.experiments ?? [])}`
    : '\n\n（本期無 A/B 測試數據）'

  const userContent = `以下是本期社群數據摘要，請生成洞察報告：

期間：${summary.period}
產業 Benchmark：${summary.benchmarkIndustry}
廣告目標：${summary.optimizationGoal ?? 'clicks'}

【整體表現】
- 發文數：${ov?.totalPosts} 則
- 平均互動率：${ov?.avgEngRate}%${erBench != null ? `（同業標準 ${erBench}%）` : ''}
- 平均觸及：${ov?.avgReach} 人
- 追蹤者成長：+${ov?.followerGrowth} 人（${ov?.followerGrowthRate}%）

【廣告表現】
- 投放金額：$${ads?.spend}
- CTR：${ads?.ctr}%${ctrBench != null ? `（同業標準 ${ctrBench}%）` : ''}
- CPC：$${ads?.cpc}
- CPM：$${ads?.cpm}

【表現最好的貼文（前3，engRate=互動率%）】
${JSON.stringify(topPosts, null, 2)}

【表現最差的貼文（後3）】
${JSON.stringify(underPosts, null, 2)}

【表現最好的廣告（前3，ctr=點擊率%）】
${JSON.stringify(topAds, null, 2)}

【表現最差的廣告（後3）】
${JSON.stringify(underAds, null, 2)}${abSection}`

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: en ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    // Extract the FIRST complete balanced {...} object (ignore any trailing prose
    // Claude may append after it, which caused "non-whitespace after JSON" errors).
    const startIdx = raw.indexOf('{')
    if (startIdx === -1) return NextResponse.json({ error: '報告格式異常，請重試' }, { status: 500 })
    let depth = 0, endIdx = -1, inStr = false, esc = false
    for (let i = startIdx; i < raw.length; i++) {
      const ch = raw[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else {
        if (ch === '"') inStr = true
        else if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break } }
      }
    }
    if (endIdx === -1) return NextResponse.json({ error: '報告格式異常，請重試' }, { status: 500 })

    const jsonSlice = raw.slice(startIdx, endIdx + 1)

    let report
    try {
      report = JSON.parse(jsonSlice)
    } catch {
      // Claude sometimes emits literal newlines/tabs inside JSON string values
      const cleaned = jsonSlice.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ')
      report = JSON.parse(cleaned)
    }

    return NextResponse.json({ report, generatedAt: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '報告生成失敗' }, { status: 500 })
  }
}
