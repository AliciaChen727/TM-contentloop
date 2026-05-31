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

interface AdSummary {
  adSnippet: string
  ctr: number
  whyItWorked?: string
  replicablePattern?: string
  issue?: string
  improvement?: string
}

interface InsightReport {
  executiveSummary: string
  topPostAnalysis: PostSummary[]
  underPerformerAnalysis: PostSummary[]
  topAdAnalysis?: AdSummary[]
  underAdAnalysis?: AdSummary[]
  abTestInsight?: string
  benchmarkInsight: string
  topRecommendations: string[]
}

interface RawAd {
  name: string
  ctr: number
  cpa: number
  spend: number
  thumbnailUrl?: string | null
  storyId?: string | null
}

interface OverviewData {
  totalPosts: number
  fbCount?: number
  igCount?: number
  avgEngRate: number
  avgReach: number
  followerGrowth: number
  followerGrowthRate: number
}

interface BenchmarkStatus { value: number; benchmark: number; status: 'above' | 'below' | 'nodata' }

interface RawPost {
  id: string
  message: string
  engRate: number
  permalink: string
  platform?: 'FB' | 'IG'
}

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
  topPosts?: RawPost[]
  underPosts?: RawPost[]
  topAds?: RawAd[]
  underAds?: RawAd[]
  hasAbTest?: boolean
  benchmarkCompare: { fb: { engagementRate: BenchmarkStatus; followerGrowth: BenchmarkStatus; adCtr: BenchmarkStatus; adCpc: BenchmarkStatus; adCpm: BenchmarkStatus } }
  benchmarkIndustry: string
  adsSummary: { spend: number; ctr: number; cpm: number; cpc: number; clicks: number; impressions: number; frequency: number; reach: number; adCount: number }
}

// Returns a Date only if the input parses to a valid one, else null.
function validDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Normalize text for fuzzy name matching (strip punctuation/brackets/spaces).
function normalizeName(s: string): string {
  return (s || '').replace(/[「」『』《》【】\[\]()（）"'：:、，。.,#＃\s]/g, '').toLowerCase()
}

// Match an AI analysis item back to the original post (for the permalink).
// 1) exact engRate match  2) name/snippet overlap with post message  3) same index.
function matchPostLink(items: RawPost[] | undefined, engRate: number, index: number, snippet?: string): string {
  if (!items || items.length === 0) return ''
  const byRate = items.find(p => Math.abs(p.engRate - engRate) < 0.01)
  if (byRate?.permalink) return byRate.permalink
  // Name-based: AI snippet echoes the post message
  const n = normalizeName(snippet ?? '')
  if (n.length >= 4) {
    const byName = items.find(p => {
      const t = normalizeName(p.message)
      if (t.length < 4) return false
      const a = n.slice(0, 8), b = t.slice(0, 8)
      return n.includes(b) || t.includes(a) || t.startsWith(a.slice(0, 6)) || n.startsWith(b.slice(0, 6))
    })
    if (byName?.permalink) return byName.permalink
  }
  return items[index]?.permalink ?? ''
}

// Match an AI ad-analysis item to the original ad (by CTR, fallback index) → FB/IG link.
function matchAdLink(items: RawAd[] | undefined, ctr: number, index: number): string {
  if (!items || items.length === 0) return ''
  const ad = items.find(a => Math.abs(a.ctr - ctr) < 0.01) ?? items[index] ?? null
  if (!ad?.storyId) return ''
  return `https://www.facebook.com/${ad.storyId}`
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

function buildPrintHTML(summary: Summary, report: InsightReport): string {
  const bm = summary.benchmarkCompare.fb
  const ads = summary.adsSummary
  const ov = summary.overview
  const GOAL_MAP: Record<string, string> = { clicks: '提升點擊率', conversion: '提升轉換與ROI', reach: '擴大品牌觸及', event: '活動報名推廣' }

  const bmRow = (label: string, value: string, bench: string, status: 'above' | 'below' | 'nodata', lowerIsBetter = false) => {
    let badge: string, color: string
    if (status === 'nodata') { badge = '無資料'; color = '#9ca3af' }
    else if (status === 'above') { badge = lowerIsBetter ? '較省 ✓' : '優於同業 ↑'; color = '#16a34a' }
    else { badge = lowerIsBetter ? '較貴 ↑' : '低於同業 ↓'; color = '#ca8a04' }
    return `<tr><td>${label}</td><td><strong>${value}</strong></td><td style="color:#888">${bench}</td><td style="color:${color}">${badge}</td></tr>`
  }

  const statCard = (label: string, value: string) =>
    `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`

  const postCard = (p: PostSummary, type: 'top' | 'under', index: number) => {
    const link = matchPostLink(type === 'top' ? summary.topPosts : summary.underPosts, p.engRate, index, p.postSnippet)
    return `
    <div class="post-card ${type}">
      <div class="post-header">互動率 ${p.engRate}%&nbsp;·&nbsp;「${p.postSnippet}⋯」${link ? ` &nbsp;<a href="${link}" style="color:inherit">查看貼文 ↗</a>` : ''}</div>
      ${type === 'top'
        ? `<div>💡 ${p.whyItWorked}</div><div class="post-pattern">📌 可複製模式：${p.replicablePattern}</div>`
        : `<div>⚠️ 問題：${p.issue}</div><div class="post-pattern">🔧 建議：${p.improvement}</div>`}
    </div>`
  }

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>洞察報告 ${summary.period}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 13px; color: #1f2937; background: white; padding: 32px 40px; }
  h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 700; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .meta { font-size: 11px; color: #6b7280; margin-bottom: 24px; }
  .goal-badge { display: inline-block; font-size: 11px; background: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 10px; margin-left: 8px; font-weight: 500; }
  .exec { background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 6px; line-height: 1.7; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f9fafb; padding: 8px 10px; text-align: left; font-weight: 600; color: #374151; border: 1px solid #e5e7eb; }
  td { padding: 8px 10px; border: 1px solid #e5e7eb; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .stat-label { font-size: 10px; color: #9ca3af; margin-bottom: 4px; }
  .stat-value { font-size: 18px; font-weight: 700; }
  .section-label { font-size: 10px; font-weight: 700; color: #9ca3af; letter-spacing: 0.05em; margin: 16px 0 6px; text-transform: uppercase; }
  .post-card { padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; line-height: 1.6; font-size: 12px; }
  .post-card.top { background: #f0fdf4; border: 1px solid #86efac; }
  .post-card.under { background: #fff7ed; border: 1px solid #fdba74; }
  .post-header { font-weight: 700; margin-bottom: 4px; }
  .post-pattern { font-size: 11px; margin-top: 4px; opacity: 0.8; }
  .benchmark-insight { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; line-height: 1.7; }
  ol { padding-left: 20px; }
  ol li { margin-bottom: 6px; line-height: 1.6; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: right; }
  @media print { body { padding: 20px 24px; } @page { margin: 1cm; } }
</style></head><body>
<h1>📊 洞察報告<span class="goal-badge">🎯 ${GOAL_MAP[summary.optimizationGoal] ?? summary.optimizationGoal}</span></h1>
<div class="meta">期間：${summary.period}${summary.isPartial ? `（統計至 ${summary.dataAsOf}）` : ''} &nbsp;·&nbsp; 基準：${summary.benchmarkIndustry} &nbsp;·&nbsp; 生成時間：${new Date().toLocaleString('zh-TW')}</div>

<h2>✨ 執行摘要</h2>
<div class="exec">${report.executiveSummary}</div>

<h2>📈 同業 Benchmark 比較</h2>
<table><thead><tr><th>指標</th><th>本期表現</th><th>同業基準</th><th>評估</th></tr></thead><tbody>
${bmRow('平均互動率（FB+IG）', `${bm.engagementRate.value}%`, `${bm.engagementRate.benchmark}%`, bm.engagementRate.status)}
${bmRow('追蹤者成長率', `${bm.followerGrowth.value}%`, `${bm.followerGrowth.benchmark}%`, bm.followerGrowth.status)}
${bmRow('廣告 CTR', `${bm.adCtr.value}%`, `${bm.adCtr.benchmark}%`, bm.adCtr.status)}
${bmRow('廣告 CPA（每次行動成本）', `$${Number(bm.adCpc.value).toFixed(2)}`, `$${bm.adCpc.benchmark}`, bm.adCpc.status, true)}
</tbody></table>
<div class="benchmark-insight" style="margin-top:10px">${report.benchmarkInsight}</div>

<div class="section-label">有機貼文</div>
<div class="stats-grid">
  ${statCard('發文數', `${ov.totalPosts} 則`)}
  ${statCard('平均互動率', `${ov.avgEngRate}%`)}
  ${statCard('平均觸及', `${ov.avgReach.toLocaleString()} 人`)}
  ${statCard('追蹤成長', `+${ov.followerGrowth} 人`)}
</div>

<div class="section-label">廣告投放</div>
<div class="stats-grid">
  ${statCard('CTR', `${ads.ctr}%`)}
  ${statCard('CPA', `$${Number(ads.cpc).toFixed(2)}`)}
  ${statCard('CPM', `$${Number(ads.cpm).toFixed(2)}`)}
  ${statCard('總花費', `$${Number(ads.spend).toLocaleString()}`)}
  ${statCard('連結點擊', `${ads.clicks.toLocaleString()} 次`)}
  ${statCard('觸及人數', ads.reach > 0 ? `${(ads.reach / 10000).toFixed(1)} 萬` : '-')}
  ${statCard('頻率', String(ads.frequency))}
  ${statCard('廣告數', `${ads.adCount} 則`)}
</div>

<h2>🌟 表現最佳貼文分析</h2>
${report.topPostAnalysis.map((p, i) => postCard(p, 'top', i)).join('')}

<h2>📉 需改善貼文分析</h2>
${report.underPerformerAnalysis.map((p, i) => postCard(p, 'under', i)).join('')}
${report.abTestInsight ? `<h2>🧪 A/B 測試洞察</h2><div class="benchmark-insight">${report.abTestInsight}</div>` : ''}
${(report.topAdAnalysis && report.topAdAnalysis.length > 0) ? `<h2>${report.topAdAnalysis.length === 1 && (!report.underAdAnalysis || report.underAdAnalysis.length === 0) ? '📊 廣告分析' : '🏆 表現最佳廣告分析'}</h2>${report.topAdAnalysis.map(a => `<div class="post-card top"><div class="post-header">CTR ${a.ctr}%&nbsp;·&nbsp;「${a.adSnippet}⋯」</div><div>💡 ${a.whyItWorked}</div><div class="post-pattern">📌 可複製模式：${a.replicablePattern}</div></div>`).join('')}` : ''}
${(report.underAdAnalysis && report.underAdAnalysis.length > 0) ? `<h2>📉 需改善廣告分析</h2>${report.underAdAnalysis.map(a => `<div class="post-card under"><div class="post-header">CTR ${a.ctr}%&nbsp;·&nbsp;「${a.adSnippet}⋯」</div><div>⚠️ 問題：${a.issue}</div><div class="post-pattern">🔧 建議：${a.improvement}</div></div>`).join('')}` : ''}

<h2>🎯 Top 3 行動建議</h2>
<ol>${report.topRecommendations.map(r => `<li>${r}</li>`).join('')}</ol>

<div class="footer">ContentLoop · 洞察報告 · ${summary.period}</div>
</body></html>`
}

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_QUARTER = Math.ceil(CURRENT_MONTH / 3)
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR].filter(y => y >= 2024)

function StatusBadge({ status, lowerIsBetter = false }: { status: 'above' | 'below' | 'nodata'; lowerIsBetter?: boolean }) {
  if (status === 'nodata') return <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af', fontWeight: 600 }}>無資料</span>
  const good = status === 'above'
  const label = lowerIsBetter ? (good ? '較省 ✓' : '較貴 ↑') : (good ? '優於同業 ↑' : '低於同業 ↓')
  return good
    ? <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#dcfce7', color: '#16a34a', fontWeight: 600 }}>{label}</span>
    : <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#fef9c3', color: '#ca8a04', fontWeight: 600 }}>{label}</span>
}

const selectStyle: React.CSSProperties = {
  fontSize: 13, padding: '5px 10px', borderRadius: 7,
  border: '1px solid var(--ad-border)', background: 'white',
  color: 'var(--ad-text)', cursor: 'pointer',
}

// Fingerprint of the underlying data — if this changes, a cached Claude report
// is stale and should be regenerated. Built from the metrics that drive the report.
function fingerprintOf(s: Summary): string {
  const a = s.adsSummary, o = s.overview
  // v3: A/B insight now uses concrete per-variant data, so regenerate old caches.
  return ['v3', a.ctr, a.cpc, a.cpm, a.spend, a.clicks, o.totalPosts, o.avgEngRate, o.followerGrowth].join('|')
}

export function InsightsSection({ pageId, onAskAI }: { pageId: string; onAskAI?: (q: string) => void }) {
  const [periodType, setPeriodType] = useState<'month' | 'quarter' | 'year'>('month')
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [quarter, setQuarter] = useState(CURRENT_QUARTER)
  const [loading, setLoading] = useState(false)
  const [cacheChecking, setCacheChecking] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [report, setReport] = useState<InsightReport | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [fromCache, setFromCache] = useState(false)
  const [staleCache, setStaleCache] = useState(false)
  const [error, setError] = useState('')

  // Derived period key for cache lookup
  const periodKey = periodType === 'year'
    ? `${year}`
    : periodType === 'month'
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
      setStaleCache(false)
      setError('')
      try {
        const user = auth.currentUser
        const idToken = user ? await user.getIdToken() : null
        if (!idToken) return
        const headers = { Authorization: `Bearer ${idToken}` }

        // Always fetch FRESH summary (cheap, no Claude) so numbers are never stale.
        const params = new URLSearchParams({ pageId, periodType, year: String(year) })
        if (periodType === 'month') params.set('month', String(month))
        else if (periodType === 'quarter') params.set('quarter', String(quarter))
        const [sumRes, cacheRes] = await Promise.all([
          fetch(`/api/insights/summary?${params}`, { headers }),
          fetch(`/api/insights/cache?pageId=${pageId}&periodKey=${periodKey}`, { headers }),
        ])
        if (cancelled) return

        const freshSummary: Summary | null = sumRes.ok ? await sumRes.json() : null
        if (freshSummary && !cancelled) setSummary(freshSummary)

        const { cached } = cacheRes.ok ? await cacheRes.json() : { cached: null }
        if (cached?.report && freshSummary && !cancelled) {
          const freshFp = fingerprintOf(freshSummary)
          const cachedFp = cached.dataFingerprint ?? null
          if (cachedFp && cachedFp === freshFp) {
            // Data unchanged → reuse cached Claude report (no tokens burned)
            setReport(cached.report)
            setFromCache(true)
            // Server already normalizes generatedAt to an ISO string (or null)
            const ts = typeof cached.generatedAt === 'string' ? cached.generatedAt : ''
            setGeneratedAt(ts)
          } else {
            // Data changed (or legacy cache w/o fingerprint) → mark stale, prompt regenerate
            setStaleCache(true)
          }
        }
      } catch { /* non-critical */ } finally {
        if (!cancelled) setCacheChecking(false)
      }
    }
    checkCache()
    return () => { cancelled = true }
  }, [pageId, periodKey, periodType, year, month, quarter])

  async function generate(forceRegen = false) {
    if (forceRegen) {
      setReport(null)
      setFromCache(false)
    }
    setStaleCache(false)
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
      else if (periodType === 'quarter') params.set('quarter', String(quarter))

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

      // Step 3: save to cache (with data fingerprint for staleness detection)
      await fetch('/api/insights/cache', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, periodKey: sumData.periodKey, report: repData.report, summary: sumData, dataFingerprint: fingerprintOf(sumData) }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  const metricRow = (label: string, data: BenchmarkStatus, unit = '%', lowerIsBetter = false) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--ad-border)' }}>
      <span style={{ fontSize: 13, color: 'var(--ad-text2)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{data.value}{unit}</span>
        <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>同業 {data.benchmark}{unit}</span>
        <StatusBadge status={data.status} lowerIsBetter={lowerIsBetter} />
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

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Type toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ad-border)' }}>
          {(['month', 'quarter', 'year'] as const).map(p => (
            <button key={p} onClick={() => setPeriodType(p)}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: periodType === p ? 'var(--ad-blue)' : 'white', color: periodType === p ? 'white' : 'var(--ad-text2)', transition: 'all 0.15s' }}>
              {p === 'month' ? '月' : p === 'quarter' ? '季' : '年'}
            </button>
          ))}
        </div>

        {/* Year */}
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle}>
          {YEARS.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>

        {/* Month / Quarter (hidden for year) */}
        {periodType === 'month' && (
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
        )}
        {periodType === 'quarter' && (
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
          <>
            <button onClick={() => generate(true)} disabled={loading}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid var(--ad-border)', background: 'white', color: 'var(--ad-text2)', cursor: loading ? 'default' : 'pointer' }}>
              {loading ? '⋯' : '↻ 重新生成'}
            </button>
            {summary && (
              <button onClick={() => {
                const win = window.open('', '_blank')
                if (!win) return
                win.document.write(buildPrintHTML(summary, report))
                win.document.close()
                win.focus()
                setTimeout(() => win.print(), 400)
              }}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>
                📄 匯出 PDF
              </button>
            )}
          </>
        )}

        {/* Status indicators */}
        {cacheChecking && <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>檢查快取⋯</span>}
        {fromCache && !loading && validDate(generatedAt) && (
          <span style={{ fontSize: 11, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>
            ⚡ 快取載入 · {validDate(generatedAt)!.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {!fromCache && !loading && validDate(generatedAt) && (
          <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>
            生成於 {validDate(generatedAt)!.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Period range banner — always selected month 1st → month-end (or today if not reached) */}
      {summary && (
        <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, fontSize: 12,
          background: summary.isPartial ? '#fffbeb' : '#f0f9ff',
          border: `1px solid ${summary.isPartial ? '#fcd34d' : '#bae6fd'}`,
          color: summary.isPartial ? '#92400e' : '#0369a1' }}>
          📅 資料區間 {summary.dateRange.start} ~ {summary.dateRange.end}
          {summary.isPartial && '（本期尚未結束，統計至今日）'}
        </div>
      )}

      {/* Stale cache: data changed since last report */}
      {staleCache && !loading && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd', fontSize: 12, color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>🔄 數據已更新（與上次生成報告時不同），下方數字為最新；AI 文字分析需重新生成才會更新。</span>
          <button onClick={() => generate(true)}
            style={{ flexShrink: 0, padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: 'var(--ad-blue)', color: 'white', cursor: 'pointer' }}>
            ✨ 重新生成
          </button>
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
          {metricRow('平均互動率（FB+IG）', summary.benchmarkCompare.fb.engagementRate)}
          {metricRow('追蹤者成長率', summary.benchmarkCompare.fb.followerGrowth)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? ['adCtr']).includes('adCtr') && metricRow('廣告 CTR', summary.benchmarkCompare.fb.adCtr)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpc') && metricRow('廣告 CPA（每次行動成本）', summary.benchmarkCompare.fb.adCpc, '', true)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpm') && metricRow('廣告 CPM', summary.benchmarkCompare.fb.adCpm, '', true)}
          {summary.adsDateRange && (summary.adsDateRange.start !== summary.dateRange.start || summary.adsDateRange.end !== summary.dateRange.end) && (
            <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 6 }}>
              ※ 廣告數據實際涵蓋 {summary.adsDateRange.start} ~ {summary.adsDateRange.end}（此區間有投放數據；如需補齊請調整表頭日期重新同步）
            </div>
          )}
        </div>
      )}

      {/* Stats cards — two rows */}
      {summary && (
        <>
          {/* Row 1: Organic */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ad-text3)', marginBottom: 6, letterSpacing: '0.05em' }}>有機貼文</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            {[
              { label: '發文數', value: String(summary.overview.totalPosts), unit: summary.overview.fbCount != null ? `則（FB ${summary.overview.fbCount}・IG ${summary.overview.igCount ?? 0}）` : '則' },
              { label: '平均互動率', value: `${summary.overview.avgEngRate}%`, unit: '' },
              { label: '平均觸及', value: summary.overview.avgReach.toLocaleString(), unit: '人' },
              { label: '追蹤成長', value: `+${summary.overview.followerGrowth}`, unit: '人' },
            ].map(c => (
              <div key={c.label} style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{c.value}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ad-text3)', marginLeft: 2 }}>{c.unit}</span></div>
              </div>
            ))}
          </div>
          {/* Row 2: Ads */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ad-text3)', marginBottom: 6, letterSpacing: '0.05em' }}>廣告投放</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: '廣告 CTR', value: `${summary.adsSummary.ctr}%`, unit: '' },
              { label: '廣告 CPA', value: `$${Number(summary.adsSummary.cpc).toFixed(2)}`, unit: '' },
              { label: '廣告 CPM', value: `$${Number(summary.adsSummary.cpm).toFixed(2)}`, unit: '' },
              { label: '總花費', value: `$${Number(summary.adsSummary.spend).toLocaleString()}`, unit: '' },
              { label: '連結點擊數', value: summary.adsSummary.clicks.toLocaleString(), unit: '次' },
              { label: '觸及人數', value: summary.adsSummary.reach > 0 ? (summary.adsSummary.reach / 10000).toFixed(1) + '萬' : '-', unit: '' },
              { label: '頻率', value: String(summary.adsSummary.frequency), unit: '' },
              { label: '廣告數', value: String(summary.adsSummary.adCount), unit: '則' },
            ].map(c => (
              <div key={c.label} style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{c.value}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ad-text3)', marginLeft: 2 }}>{c.unit}</span></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* AI Report */}
      {report && summary && (
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
              {report.topPostAnalysis.map((p, i) => {
                const link = matchPostLink(summary.topPosts, p.engRate, i, p.postSnippet)
                return (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」</span>
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#16a34a', fontWeight: 700, textDecoration: 'none' }}>查看貼文 ↗</a>}
                  </div>
                  <div style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>💡 {p.whyItWorked}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>📌 可複製模式：{p.replicablePattern}</div>
                </div>
                )
              })}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 需改善貼文分析</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.underPerformerAnalysis.map((p, i) => {
                const link = matchPostLink(summary.underPosts, p.engRate, i, p.postSnippet)
                return (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74' }}>
                  <div style={{ fontSize: 12, color: '#c2410c', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>互動率 {p.engRate}% &nbsp;·&nbsp; 「{p.postSnippet}⋯」</span>
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#ea580c', fontWeight: 700, textDecoration: 'none' }}>查看貼文 ↗</a>}
                  </div>
                  <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 4 }}>⚠️ 問題：{p.issue}</div>
                  <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 500 }}>🔧 建議：{p.improvement}</div>
                </div>
                )
              })}
            </div>
          </div>

          {/* A/B test insight */}
          {report.abTestInsight && (
            <div style={{ background: '#faf5ff', borderRadius: 10, border: '1px solid #d8b4fe', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#7c3aed' }}>🧪 A/B 測試洞察</div>
              <p style={{ fontSize: 13, color: '#6b21a8', lineHeight: 1.7, margin: 0 }}>{report.abTestInsight}</p>
            </div>
          )}

          {/* Best ads (single ad → just "廣告分析") */}
          {report.topAdAnalysis && report.topAdAnalysis.length > 0 && (
            <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                {report.topAdAnalysis.length === 1 && (!report.underAdAnalysis || report.underAdAnalysis.length === 0) ? '📊 廣告分析' : '🏆 表現最佳廣告分析'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {report.topAdAnalysis.map((a, i) => {
                  const link = matchAdLink(summary.topAds, a.ctr, i)
                  return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd' }}>
                    <div style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>CTR {a.ctr}% &nbsp;·&nbsp; 「{a.adSnippet}⋯」</span>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}>查看廣告 ↗</a>}
                    </div>
                    <div style={{ fontSize: 12, color: '#1e40af', marginBottom: 4 }}>💡 {a.whyItWorked}</div>
                    <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 500 }}>📌 可複製模式：{a.replicablePattern}</div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Worst ads */}
          {report.underAdAnalysis && report.underAdAnalysis.length > 0 && (
            <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 需改善廣告分析</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {report.underAdAnalysis.map((a, i) => {
                  const link = matchAdLink(summary.underAds, a.ctr, i)
                  return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5' }}>
                    <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>CTR {a.ctr}% &nbsp;·&nbsp; 「{a.adSnippet}⋯」</span>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#dc2626', fontWeight: 700, textDecoration: 'none' }}>查看廣告 ↗</a>}
                    </div>
                    <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 4 }}>⚠️ 問題：{a.issue}</div>
                    <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>🔧 建議：{a.improvement}</div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

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
