'use client'
import { useState } from 'react'
import { auth } from '@/lib/firebase/client'

interface PostSummary {
  postSnippet: string
  engRate: number
  whyItWorked?: string
  replicablePattern?: string
  issue?: string
  improvement?: string
}

interface InsightReport {
  executiveSummary: string
  topPostAnalysis: PostSummary[]
  underPerformerAnalysis: PostSummary[]
  benchmarkInsight: string
  topRecommendations: string[]
}

interface OverviewData {
  totalPosts: number
  avgEngRate: number
  avgReach: number
  followerGrowth: number
  followerGrowthRate: number
}

interface BenchmarkStatus { value: number; benchmark: number; status: 'above' | 'below' }

interface Summary {
  period: string
  dateRange: { start: string; end: string }
  adsDateRange: { start: string; end: string } | null
  overview: OverviewData
  benchmarkCompare: { fb: { engagementRate: BenchmarkStatus; followerGrowth: BenchmarkStatus; adCtr: BenchmarkStatus } }
  benchmarkIndustry: string
  adsSummary: { spend: number; ctr: number; cpm: number; adCount: number }
}

function StatusBadge({ status }: { status: 'above' | 'below' }) {
  return status === 'above'
    ? <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#dcfce7', color: '#16a34a', fontWeight: 600 }}>優於同業 ↑</span>
    : <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#fef9c3', color: '#ca8a04', fontWeight: 600 }}>低於同業 ↓</span>
}

export function InsightsSection({ pageId, onAskAI }: { pageId: string; onAskAI?: (q: string) => void }) {
  const [period, setPeriod] = useState<'month' | 'quarter'>('month')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [report, setReport] = useState<InsightReport | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [error, setError] = useState('')

  async function generate() {
    setLoading(true)
    setError('')
    setReport(null)
    setSummary(null)
    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      if (!idToken) throw new Error('請先登入')
      const headers = { Authorization: `Bearer ${idToken}` }

      // Step 1: fetch aggregated summary
      const sumRes = await fetch(`/api/insights/summary?pageId=${pageId}&period=${period}`, { headers })
      if (!sumRes.ok) throw new Error('資料載入失敗')
      const sumData: Summary = await sumRes.json()
      setSummary(sumData)

      // Step 2: generate AI report
      const repRes = await fetch('/api/insights/report', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: sumData }),
      })
      if (!repRes.ok) {
        const e = await repRes.json().catch(() => ({}))
        throw new Error(e.error ?? '報告生成失敗')
      }
      const repData = await repRes.json()
      setReport(repData.report)
      setGeneratedAt(repData.generatedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  const metricRow = (label: string, data: BenchmarkStatus, unit = '%') => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--ad-border)' }}>
      <span style={{ fontSize: 13, color: 'var(--ad-text2)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{data.value}{unit}</span>
        <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>同業 {data.benchmark}{unit}</span>
        <StatusBadge status={data.status} />
      </div>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="ads-section-header">
        <span style={{ fontSize: 16 }}>📊</span>
        <span className="ads-section-title">洞察報告</span>
      </div>

      {/* Period picker + generate button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ad-border)' }}>
          {(['month', 'quarter'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding: '6px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: period === p ? 'var(--ad-blue)' : 'white', color: period === p ? 'white' : 'var(--ad-text2)', transition: 'all 0.15s' }}>
              {p === 'month' ? '本月' : '本季'}
            </button>
          ))}
        </div>
        <button onClick={generate} disabled={loading}
          style={{ padding: '7px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: loading ? '#94a3b8' : 'var(--ad-blue)', color: 'white', cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? '⋯ 分析中' : '✨ 生成洞察報告'}
        </button>
        {generatedAt && <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>生成於 {new Date(generatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
          ❌ {error}
        </div>
      )}

      {/* Benchmark overview (shows after summary loads) */}
      {summary && (
        <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>同業 Benchmark 比較</span>
            <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>基準：{summary.benchmarkIndustry}</span>
          </div>
          {metricRow('FB 平均互動率', summary.benchmarkCompare.fb.engagementRate)}
          {metricRow('追蹤者成長率', summary.benchmarkCompare.fb.followerGrowth)}
          <div>
            {metricRow('廣告 CTR', summary.benchmarkCompare.fb.adCtr)}
            {summary.adsDateRange && (
              <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 2 }}>
                廣告資料：{summary.adsDateRange.start} ~ {summary.adsDateRange.end}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: '發文數', value: summary.overview.totalPosts, unit: '則' },
            { label: '平均互動率', value: `${summary.overview.avgEngRate}%`, unit: '' },
            { label: '平均觸及', value: summary.overview.avgReach.toLocaleString(), unit: '人' },
            { label: '追蹤成長', value: `+${summary.overview.followerGrowth}`, unit: '人' },
          ].map(c => (
            <div key={c.label} style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ad-text3)', marginLeft: 2 }}>{c.unit}</span></div>
            </div>
          ))}
        </div>
      )}

      {/* AI Report */}
      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Executive Summary */}
          <div className="ads-ai-box" style={{ flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>✨</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>執行摘要</span>
              {onAskAI && <button className="ads-diag-ask-btn" style={{ marginLeft: 'auto' }} onClick={() => onAskAI(`根據本月洞察報告：${report.executiveSummary}，請給我3個具體的下一步行動建議`)}>問 AI ›</button>}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, color: 'var(--ad-text2)' }}>{report.executiveSummary}</p>
          </div>

          {/* Benchmark insight */}
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🏆 同業比較洞察</div>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', lineHeight: 1.7, margin: 0 }}>{report.benchmarkInsight}</p>
          </div>

          {/* Top posts */}
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>🌟 表現最佳貼文分析</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.topPostAnalysis.map((p, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 4 }}>
                    互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」
                  </div>
                  <div style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>💡 {p.whyItWorked}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>📌 可複製模式：{p.replicablePattern}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Underperformers */}
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 需改善貼文分析</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.underPerformerAnalysis.map((p, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74' }}>
                  <div style={{ fontSize: 12, color: '#c2410c', fontWeight: 600, marginBottom: 4 }}>
                    互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」
                  </div>
                  <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 4 }}>⚠️ 問題：{p.issue}</div>
                  <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 500 }}>🔧 建議：{p.improvement}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🎯 本期 Top 3 行動建議</div>
            <ol style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {report.topRecommendations.map((r, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--ad-text2)', lineHeight: 1.6 }}>{r}</li>
              ))}
            </ol>
            {onAskAI && (
              <button className="ads-btn" style={{ marginTop: 12, fontSize: 12 }}
                onClick={() => onAskAI(`我想深入了解這份洞察報告的行動建議：${report.topRecommendations.join('；')}，幫我規劃下週的內容計畫`)}>
                ✨ 請 AI 規劃下週內容
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
