'use client'
import { useState, useEffect } from 'react'
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
  periodKey: string
  isPartial: boolean
  dataAsOf: string
  dateRange: { start: string; end: string }
  adsDateRange: { start: string; end: string } | null
  optimizationGoal: string
  industry: string
  overview: OverviewData
  benchmarkCompare: { fb: { engagementRate: BenchmarkStatus; followerGrowth: BenchmarkStatus; adCtr: BenchmarkStatus; adCpc: BenchmarkStatus; adCpm: BenchmarkStatus } }
  benchmarkIndustry: string
  adsSummary: { spend: number; ctr: number; cpm: number; cpc: number; clicks: number; impressions: number; frequency: number; reach: number; adCount: number }
}

const GOAL_LABELS: Record<string, string> = {
  clicks: '提升點擊率', conversion: '提升轉換與ROI', reach: '擴大品牌觸及', event: '活動報名推廣',
}

// Which ad benchmark rows to show per goal
const GOAL_AD_METRICS: Record<string, string[]> = {
  clicks: ['adCtr', 'adCpc'],
  conversion: ['adCtr', 'adCpc'],
  reach: ['adCpm'],
  event: ['adCtr', 'adCpc', 'adCpm'],
}

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_QUARTER = Math.ceil(CURRENT_MONTH / 3)
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR].filter(y => y >= 2024)

function StatusBadge({ status }: { status: 'above' | 'below' }) {
  return status === 'above'
    ? <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#dcfce7', color: '#16a34a', fontWeight: 600 }}>優於同業 ↑</span>
    : <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#fef9c3', color: '#ca8a04', fontWeight: 600 }}>低於同業 ↓</span>
}

const selectStyle: React.CSSProperties = {
  fontSize: 13, padding: '5px 10px', borderRadius: 7,
  border: '1px solid var(--ad-border)', background: 'white',
  color: 'var(--ad-text)', cursor: 'pointer',
}

export function InsightsSection({ pageId, onAskAI }: { pageId: string; onAskAI?: (q: string) => void }) {
  const [periodType, setPeriodType] = useState<'month' | 'quarter'>('month')
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [quarter, setQuarter] = useState(CURRENT_QUARTER)
  const [loading, setLoading] = useState(false)
  const [cacheChecking, setCacheChecking] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [report, setReport] = useState<InsightReport | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState('')

  // Derived period key for cache lookup
  const periodKey = periodType === 'month'
    ? `${year}-${String(month).padStart(2, '0')}`
    : `${year}-Q${quarter}`

  // Check cache when period selection changes
  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    async function checkCache() {
      setCacheChecking(true)
      setReport(null)
      setSummary(null)
      setFromCache(false)
      setError('')
      try {
        const user = auth.currentUser
        const idToken = user ? await user.getIdToken() : null
        if (!idToken) return
        const res = await fetch(`/api/insights/cache?pageId=${pageId}&periodKey=${periodKey}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!res.ok || cancelled) return
        const { cached } = await res.json()
        if (cached?.report && !cancelled) {
          setReport(cached.report)
          setSummary(cached.summary)
          setFromCache(true)
          const ts = cached.generatedAt?.toDate?.()?.toISOString?.() ?? cached.generatedAt ?? ''
          setGeneratedAt(ts)
        }
      } catch { /* non-critical */ } finally {
        if (!cancelled) setCacheChecking(false)
      }
    }
    checkCache()
    return () => { cancelled = true }
  }, [pageId, periodKey])

  async function generate(forceRegen = false) {
    if (forceRegen) {
      setReport(null)
      setSummary(null)
      setFromCache(false)
    }
    setLoading(true)
    setError('')
    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      if (!idToken) throw new Error('請先登入')
      const headers = { Authorization: `Bearer ${idToken}` }

      // Build query params
      const params = new URLSearchParams({ pageId, periodType, year: String(year) })
      if (periodType === 'month') params.set('month', String(month))
      else params.set('quarter', String(quarter))

      // Step 1: fetch summary
      const sumRes = await fetch(`/api/insights/summary?${params}`, { headers })
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
      setFromCache(false)

      // Step 3: save to cache
      await fetch('/api/insights/cache', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, periodKey: sumData.periodKey, report: repData.report, summary: sumData }),
      })
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

  const isCurrentPeriod = periodType === 'month'
    ? year === CURRENT_YEAR && month === CURRENT_MONTH
    : year === CURRENT_YEAR && quarter === CURRENT_QUARTER

  return (
    <div>
      {/* Header */}
      <div className="ads-section-header">
        <span style={{ fontSize: 16 }}>📊</span>
        <span className="ads-section-title">洞察報告</span>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Type toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ad-border)' }}>
          {(['month', 'quarter'] as const).map(p => (
            <button key={p} onClick={() => setPeriodType(p)}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: periodType === p ? 'var(--ad-blue)' : 'white', color: periodType === p ? 'white' : 'var(--ad-text2)', transition: 'all 0.15s' }}>
              {p === 'month' ? '月' : '季'}
            </button>
          ))}
        </div>

        {/* Year */}
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle}>
          {YEARS.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>

        {/* Month or Quarter */}
        {periodType === 'month' ? (
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
        ) : (
          <select value={quarter} onChange={e => setQuarter(Number(e.target.value))} style={selectStyle}>
            <option value={1}>Q1（1-3月）</option>
            <option value={2}>Q2（4-6月）</option>
            <option value={3}>Q3（7-9月）</option>
            <option value={4}>Q4（10-12月）</option>
          </select>
        )}

        {/* Generate / Regen button */}
        {!report && !cacheChecking && (
          <button onClick={() => generate()} disabled={loading}
            style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: loading ? '#94a3b8' : 'var(--ad-blue)', color: 'white', cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {loading ? '⋯ 分析中' : '✨ 生成報告'}
          </button>
        )}
        {report && (
          <button onClick={() => generate(true)} disabled={loading}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid var(--ad-border)', background: 'white', color: 'var(--ad-text2)', cursor: loading ? 'default' : 'pointer' }}>
            {loading ? '⋯' : '↻ 重新生成'}
          </button>
        )}

        {/* Status indicators */}
        {cacheChecking && <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>檢查快取⋯</span>}
        {fromCache && !loading && (
          <span style={{ fontSize: 11, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>
            ⚡ 快取載入 · {generatedAt ? new Date(generatedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        )}
        {!fromCache && generatedAt && !loading && (
          <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>
            生成於 {new Date(generatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Partial period warning */}
      {(isCurrentPeriod || (summary?.isPartial)) && (
        <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d', fontSize: 12, color: '#92400e' }}>
          ⏳ 本期間尚未結束，統計至 {summary?.dataAsOf ?? new Date().toISOString().slice(0, 10)}
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
          ❌ {error}
        </div>
      )}

      {/* Benchmark overview */}
      {summary && (
        <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>同業 Benchmark 比較</span>
              {summary.optimizationGoal && (
                <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontWeight: 500 }}>
                  🎯 {GOAL_LABELS[summary.optimizationGoal] ?? summary.optimizationGoal}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>基準：{summary.benchmarkIndustry}</span>
          </div>
          {metricRow('FB 平均互動率', summary.benchmarkCompare.fb.engagementRate)}
          {metricRow('追蹤者成長率', summary.benchmarkCompare.fb.followerGrowth)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? ['adCtr']).includes('adCtr') && metricRow('廣告 CTR', summary.benchmarkCompare.fb.adCtr)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpc') && metricRow('廣告 CPC', summary.benchmarkCompare.fb.adCpc, '')}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpm') && metricRow('廣告 CPM', summary.benchmarkCompare.fb.adCpm, '')}
          {summary.adsDateRange && (
            <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 6 }}>
              廣告資料：{summary.adsDateRange.start} ~ {summary.adsDateRange.end}
            </div>
          )}
        </div>
      )}

      {/* Stats cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: '發文數', value: summary.overview.totalPosts, unit: '則' },
            { label: '平均互動率', value: `${summary.overview.avgEngRate}%`, unit: '' },
            { label: '廣告 CTR', value: `${summary.adsSummary.ctr}%`, unit: '' },
            { label: '廣告 CPC', value: `$${summary.adsSummary.cpc}`, unit: '' },
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
          <div className="ads-ai-box" style={{ flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>✨</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>執行摘要</span>
              {onAskAI && <button className="ads-diag-ask-btn" style={{ marginLeft: 'auto' }} onClick={() => onAskAI(`根據本期洞察報告：${report.executiveSummary}，請給我3個具體的下一步行動建議`)}>問 AI ›</button>}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, color: 'var(--ad-text2)' }}>{report.executiveSummary}</p>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🏆 同業比較洞察</div>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', lineHeight: 1.7, margin: 0 }}>{report.benchmarkInsight}</p>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>🌟 表現最佳貼文分析</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.topPostAnalysis.map((p, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 4 }}>互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」</div>
                  <div style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>💡 {p.whyItWorked}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>📌 可複製模式：{p.replicablePattern}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 需改善貼文分析</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.underPerformerAnalysis.map((p, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74' }}>
                  <div style={{ fontSize: 12, color: '#c2410c', fontWeight: 600, marginBottom: 4 }}>互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」</div>
                  <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 4 }}>⚠️ 問題：{p.issue}</div>
                  <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 500 }}>🔧 建議：{p.improvement}</div>
                </div>
              ))}
            </div>
          </div>

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
