export const dynamic = 'force-dynamic'
export const maxDuration = 120
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth } from '@/lib/firebase/admin'
import { getUserApiKey } from '@/lib/userApiKeys'

const SYSTEM_PROMPT = `你是一位社群媒體數據分析師，專門為非營利組織與社群團體提供洞察報告。
請根據提供的數據，用繁體中文撰寫一份簡潔有力的月度洞察報告。

【JSON 格式規範 - 嚴格遵守】
1. 只輸出純 JSON，不要有任何 markdown、code fence 或多餘文字
2. 所有字串值不得包含換行符（用空格代替）
3. 所有字串值不得包含未跳脫的雙引號
4. postSnippet 只寫 15 字以內的純文字摘要，不要複製原始貼文
5. 每個字串值寫在同一行，不要換行

輸出結構：
{"executiveSummary":"3-4句摘要","topPostAnalysis":[{"postSnippet":"15字摘要","engRate":數字,"whyItWorked":"原因","replicablePattern":"模式"}],"underPerformerAnalysis":[{"postSnippet":"15字摘要","engRate":數字,"issue":"問題","improvement":"建議"}],"benchmarkInsight":"2-3句同業比較","topRecommendations":["建議1","建議2","建議3"]}`

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { summary } = await req.json() as { summary: Record<string, unknown> }
  if (!summary) return NextResponse.json({ error: 'Missing summary' }, { status: 400 })

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

  const userContent = `以下是本期社群數據摘要，請生成洞察報告：

期間：${summary.period}
產業 Benchmark：${summary.benchmarkIndustry}
廣告目標：${summary.optimizationGoal ?? 'clicks'}

【整體表現】
- 發文數：${ov?.totalPosts} 則
- 平均互動率：${ov?.avgEngRate}%
- 平均觸及：${ov?.avgReach} 人
- 追蹤者成長：+${ov?.followerGrowth} 人（${ov?.followerGrowthRate}%）

【廣告表現】
- 投放金額：$${ads?.spend}
- CTR：${ads?.ctr}%（同業標準 1.8%）
- CPC：$${ads?.cpc}
- CPM：$${ads?.cpm}

【表現最好的貼文（前3，engRate=互動率%）】
${JSON.stringify(topPosts, null, 2)}

【表現最差的貼文（後3）】
${JSON.stringify(underPosts, null, 2)}`

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
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
