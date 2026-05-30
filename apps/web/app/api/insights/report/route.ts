export const dynamic = 'force-dynamic'
export const maxDuration = 120
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth } from '@/lib/firebase/admin'
import { getUserApiKey } from '@/lib/userApiKeys'

const SYSTEM_PROMPT = `你是一位社群媒體數據分析師，專門為非營利組織與社群團體提供洞察報告。
請根據提供的數據，用繁體中文撰寫一份簡潔有力的月度洞察報告。
嚴格只輸出 JSON，結構如下：
{
  "executiveSummary": "3-4句執行摘要，點出本期最重要的發現",
  "topPostAnalysis": [
    {
      "postSnippet": "貼文開頭20字",
      "engRate": 數字,
      "whyItWorked": "具體原因（話題、格式、情感共鳴等）",
      "replicablePattern": "可複製的模式，一句話"
    }
  ],
  "underPerformerAnalysis": [
    {
      "postSnippet": "貼文開頭20字",
      "engRate": 數字,
      "issue": "問題所在",
      "improvement": "具體改善建議"
    }
  ],
  "benchmarkInsight": "2-3句，說明與同業相比的整體表現，點出最值得關注的差距",
  "topRecommendations": [
    "建議1（具體可行動）",
    "建議2",
    "建議3"
  ]
}`

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

  const apiKey = await getUserApiKey(uid, 'anthropic') ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY' }, { status: 402 })

  const anthropic = new Anthropic({ apiKey })

  const userContent = `以下是本期社群數據摘要，請生成洞察報告：

期間：${summary.period}
產業 Benchmark：${summary.benchmarkIndustry}

【整體表現】
- 發文數：${summary.overview && (summary.overview as Record<string, unknown>).totalPosts} 則
- 平均互動率：${summary.overview && (summary.overview as Record<string, unknown>).avgEngRate}%（同業標準：${(summary.benchmarkCompare as Record<string, unknown> | undefined)?.fb && ((summary.benchmarkCompare as Record<string, unknown>).fb as Record<string, unknown>).engagementRate && (((summary.benchmarkCompare as Record<string, unknown>).fb as Record<string, unknown>).engagementRate as Record<string, unknown>).benchmark}%）
- 平均觸及：${summary.overview && (summary.overview as Record<string, unknown>).avgReach} 人
- 追蹤者成長：${summary.overview && (summary.overview as Record<string, unknown>).followerGrowth} 人（${summary.overview && (summary.overview as Record<string, unknown>).followerGrowthRate}%）

【廣告表現】
- 投放金額：$${summary.adsSummary && (summary.adsSummary as Record<string, unknown>).spend}
- CTR：${summary.adsSummary && (summary.adsSummary as Record<string, unknown>).ctr}%（同業標準：${(summary.benchmarkCompare as Record<string, unknown> | undefined)?.fb && ((summary.benchmarkCompare as Record<string, unknown>).fb as Record<string, unknown>).adCtr && (((summary.benchmarkCompare as Record<string, unknown>).fb as Record<string, unknown>).adCtr as Record<string, unknown>).benchmark}%）
- CPM：$${summary.adsSummary && (summary.adsSummary as Record<string, unknown>).cpm}

【表現最好的貼文（前3）】
${JSON.stringify(summary.topPosts, null, 2)}

【表現最差的貼文（後3）】
${JSON.stringify(summary.underPosts, null, 2)}`

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: '報告格式異常，請重試' }, { status: 500 })
    }

    const report = JSON.parse(raw.slice(start, end + 1))
    return NextResponse.json({ report, generatedAt: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '報告生成失敗' }, { status: 500 })
  }
}
