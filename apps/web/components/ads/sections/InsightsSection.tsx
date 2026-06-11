'use client'
import { useState, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

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
  conversionType?: string
  overview: OverviewData
  topPosts?: RawPost[]
  underPosts?: RawPost[]
  topAds?: RawAd[]
  underAds?: RawAd[]
  hasAbTest?: boolean
  benchmarkCompare: { fb: { engagementRate: BenchmarkStatus; followerGrowth: BenchmarkStatus; adCtr: BenchmarkStatus; adCpc: BenchmarkStatus; adCpm: BenchmarkStatus; adRoas?: BenchmarkStatus } }
  benchmarkIndustry: string
  benchmarkIndustrySet?: boolean
  industryOther?: string
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

// Match an AI analysis item back to the ORIGINAL post object (stable title + link).
// 1) exact engRate match  2) name/snippet overlap with post message  3) same index.
function matchPost(items: RawPost[] | undefined, engRate: number, index: number, snippet?: string): RawPost | null {
  if (!items || items.length === 0) return null
  const byRate = items.find(p => Math.abs(p.engRate - engRate) < 0.01)
  if (byRate) return byRate
  const n = normalizeName(snippet ?? '')
  if (n.length >= 4) {
    const byName = items.find(p => {
      const t = normalizeName(p.message)
      if (t.length < 4) return false
      const a = n.slice(0, 8), b = t.slice(0, 8)
      return n.includes(b) || t.includes(a) || t.startsWith(a.slice(0, 6)) || n.startsWith(b.slice(0, 6))
    })
    if (byName) return byName
  }
  return items[index] ?? null
}

// Match an AI ad-analysis item to the ORIGINAL ad object (by CTR, fallback index).
function matchAd(items: RawAd[] | undefined, ctr: number, index: number): RawAd | null {
  if (!items || items.length === 0) return null
  return items.find(a => Math.abs(a.ctr - ctr) < 0.01) ?? items[index] ?? null
}

// Title from the real post/ad content (stable across regenerations), with fallback to AI snippet.
function titleOf(realText: string | undefined, aiSnippet: string, len = 18): string {
  const t = (realText ?? '').trim()
  return (t || aiSnippet || '').slice(0, len)
}

const GOAL_LABELS: Record<string, { zh: string; en: string }> = {
  clicks: { zh: '提升點擊率', en: 'Boost click-through' },
  conversion: { zh: '提升轉換與ROI', en: 'Conversions & ROI' },
  reach: { zh: '擴大品牌觸及', en: 'Brand reach' },
  event: { zh: '活動報名推廣', en: 'Event sign-ups' },
}

// Which ad benchmark rows to show per goal
const GOAL_AD_METRICS: Record<string, string[]> = {
  clicks: ['adCtr', 'adCpc'],
  conversion: ['adRoas', 'adCtr', 'adCpc'],
  reach: ['adCpm'],
  event: ['adCtr', 'adCpc', 'adCpm'],
}

// The benchmark industry label is a Chinese string from the backend; map the known
// ones to English for English mode (free-text industries fall through unchanged).
function industryLabel(s: string, en: boolean): string {
  if (!en) return s
  const map: Record<string, string> = {
    '電商 / 零售': 'E-commerce / Retail',
    '課程 / 教育訓練': 'Courses / Training',
    '活動 / 社群組織': 'Events / Community',
    '個人品牌 / 自媒體': 'Personal brand / Creator',
    '非營利組織 / 社群': 'Nonprofit / Community',
    '其他': 'Other',
    '未設定（暫用非營利組織 / 社群預設）': 'Not set (using Nonprofit / Community default)',
  }
  return map[s] ?? s
}

function buildPrintHTML(summary: Summary, report: InsightReport, en: boolean): string {
  const bm = summary.benchmarkCompare.fb
  const ads = summary.adsSummary
  const ov = summary.overview
  const GOAL_MAP: Record<string, string> = en
    ? { clicks: 'Boost click-through', conversion: 'Conversions & ROI', reach: 'Brand reach', event: 'Event sign-ups' }
    : { clicks: '提升點擊率', conversion: '提升轉換與ROI', reach: '擴大品牌觸及', event: '活動報名推廣' }

  const bmRow = (label: string, value: string, bench: string, status: 'above' | 'below' | 'nodata', lowerIsBetter = false) => {
    let badge: string, color: string
    if (status === 'nodata') { badge = en ? 'No data' : '無資料'; color = '#9ca3af' }
    else if (status === 'above') { badge = lowerIsBetter ? (en ? 'Cheaper ✓' : '較省 ✓') : (en ? 'Above peers ↑' : '優於同業 ↑'); color = '#16a34a' }
    else { badge = lowerIsBetter ? (en ? 'Pricier ↑' : '較貴 ↑') : (en ? 'Below peers ↓' : '低於同業 ↓'); color = '#ca8a04' }
    return `<tr><td>${label}</td><td><strong>${value}</strong></td><td style="color:#888">${bench}</td><td style="color:${color}">${badge}</td></tr>`
  }

  const statCard = (label: string, value: string) =>
    `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`

  const postCard = (p: PostSummary, type: 'top' | 'under', index: number) => {
    const post = matchPost(type === 'top' ? summary.topPosts : summary.underPosts, p.engRate, index, p.postSnippet)
    const link = post?.permalink || ''
    const title = titleOf(post?.message, p.postSnippet)
    const viewPost = en ? 'View post ↗' : '查看貼文 ↗'
    return `
    <div class="post-card ${type}">
      <div class="post-header">${en ? 'Engagement' : '互動率'} ${p.engRate}%&nbsp;·&nbsp;「${title}⋯」${link ? ` &nbsp;<a href="${link}" style="color:inherit">${viewPost}</a>` : ''}</div>
      ${type === 'top'
        ? `<div>💡 ${p.whyItWorked}</div><div class="post-pattern">📌 ${en ? 'Replicable pattern: ' : '可複製模式：'}${p.replicablePattern}</div>`
        : `<div>⚠️ ${en ? 'Issue: ' : '問題：'}${p.issue}</div><div class="post-pattern">🔧 ${en ? 'Suggestion: ' : '建議：'}${p.improvement}</div>`}
    </div>`
  }

  return `<!DOCTYPE html><html lang="${en ? 'en' : 'zh-TW'}"><head><meta charset="UTF-8">
<title>${en ? 'Insight Report' : '洞察報告'} ${summary.period}</title>
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
<h1>📊 ${en ? 'Insight Report' : '洞察報告'}<span class="goal-badge">🎯 ${GOAL_MAP[summary.optimizationGoal] ?? summary.optimizationGoal}</span></h1>
<div class="meta">${en ? 'Period' : '期間'}：${summary.period}${summary.isPartial ? (en ? `(through ${summary.dataAsOf})` : `（統計至 ${summary.dataAsOf}）`) : ''} &nbsp;·&nbsp; ${en ? 'Benchmark' : '基準'}：${industryLabel(summary.benchmarkIndustry, en)} &nbsp;·&nbsp; ${en ? 'Generated' : '生成時間'}：${new Date().toLocaleString(en ? 'en-US' : 'zh-TW')}</div>

<h2>✨ ${en ? 'Executive Summary' : '執行摘要'}</h2>
<div class="exec">${report.executiveSummary}</div>

<h2>📈 ${en ? 'Industry Benchmark' : '同業 Benchmark 比較'}</h2>
<table><thead><tr><th>${en ? 'Metric' : '指標'}</th><th>${en ? 'This period' : '本期表現'}</th><th>${en ? 'Industry' : '同業基準'}</th><th>${en ? 'Assessment' : '評估'}</th></tr></thead><tbody>
${bmRow(en ? 'Avg engagement (FB+IG)' : '平均互動率（FB+IG）', `${bm.engagementRate.value}%`, `${bm.engagementRate.benchmark}%`, bm.engagementRate.status)}
${bmRow(en ? 'Follower growth rate' : '追蹤者成長率', `${bm.followerGrowth.value}%`, `${bm.followerGrowth.benchmark}%`, bm.followerGrowth.status)}
${bmRow(en ? 'Ad CTR' : '廣告 CTR', `${bm.adCtr.value}%`, `${bm.adCtr.benchmark}%`, bm.adCtr.status)}
${bmRow(en ? 'Ad CPA (cost per action)' : '廣告 CPA（每次行動成本）', `$${Number(bm.adCpc.value).toFixed(2)}`, `$${bm.adCpc.benchmark}`, bm.adCpc.status, true)}
</tbody></table>
<div class="benchmark-insight" style="margin-top:10px">${report.benchmarkInsight}</div>

<div class="section-label">${en ? 'Organic posts' : '有機貼文'}</div>
<div class="stats-grid">
  ${statCard(en ? 'Posts' : '發文數', en ? `${ov.totalPosts}` : `${ov.totalPosts} 則`)}
  ${statCard(en ? 'Avg engagement' : '平均互動率', `${ov.avgEngRate}%`)}
  ${statCard(en ? 'Avg reach' : '平均觸及', en ? `${ov.avgReach.toLocaleString()}` : `${ov.avgReach.toLocaleString()} 人`)}
  ${statCard(en ? 'Follower growth' : '追蹤成長', en ? `+${ov.followerGrowth}` : `+${ov.followerGrowth} 人`)}
</div>

<div class="section-label">${en ? 'Ad delivery' : '廣告投放'}</div>
<div class="stats-grid">
  ${statCard('CTR', `${ads.ctr}%`)}
  ${statCard('CPA', `$${Number(ads.cpc).toFixed(2)}`)}
  ${statCard('CPM', `$${Number(ads.cpm).toFixed(2)}`)}
  ${statCard(en ? 'Total spend' : '總花費', `$${Number(ads.spend).toLocaleString()}`)}
  ${statCard(en ? 'Link clicks' : '連結點擊', en ? `${ads.clicks.toLocaleString()}` : `${ads.clicks.toLocaleString()} 次`)}
  ${statCard(en ? 'Click value' : '點擊效益', ads.spend > 0 ? (en ? `${((ads.clicks / ads.spend) * 100).toFixed(2)} /NT$100` : `${((ads.clicks / ads.spend) * 100).toFixed(2)} 次/百元`) : '-')}
  ${statCard(en ? 'Reach' : '觸及人數', ads.reach > 0 ? (en ? `${(ads.reach / 1000).toFixed(1)}K` : `${(ads.reach / 10000).toFixed(1)} 萬`) : '-')}
  ${statCard(en ? 'Frequency' : '頻率', String(ads.frequency))}
  ${statCard(en ? 'Ads' : '廣告數', en ? `${ads.adCount}` : `${ads.adCount} 則`)}
</div>

<h2>🌟 ${en ? 'Top Post Analysis' : '表現最佳貼文分析'}</h2>
${report.topPostAnalysis.map((p, i) => postCard(p, 'top', i)).join('')}

<h2>📉 ${en ? 'Posts to Improve' : '需改善貼文分析'}</h2>
${report.underPerformerAnalysis.map((p, i) => postCard(p, 'under', i)).join('')}
${report.abTestInsight ? `<h2>🧪 ${en ? 'A/B Test Insight' : 'A/B 測試洞察'}</h2><div class="benchmark-insight">${report.abTestInsight}</div>` : ''}
${(report.topAdAnalysis && report.topAdAnalysis.length > 0) ? `<h2>${report.topAdAnalysis.length === 1 && (!report.underAdAnalysis || report.underAdAnalysis.length === 0) ? (en ? '📊 Ad Analysis' : '📊 廣告分析') : (en ? '🏆 Top Ad Analysis' : '🏆 表現最佳廣告分析')}</h2>${report.topAdAnalysis.map((a, i) => { const ad = matchAd(summary.topAds, a.ctr, i); const link = ad?.storyId ? `https://www.facebook.com/${ad.storyId}` : ''; return `<div class="post-card top"><div class="post-header">CTR ${a.ctr}%&nbsp;·&nbsp;「${titleOf(ad?.name, a.adSnippet)}⋯」${link ? ` &nbsp;<a href="${link}" style="color:inherit">${en ? 'View ad ↗' : '查看廣告 ↗'}</a>` : ''}</div><div>💡 ${a.whyItWorked}</div><div class="post-pattern">📌 ${en ? 'Replicable pattern: ' : '可複製模式：'}${a.replicablePattern}</div></div>` }).join('')}` : ''}
${(report.underAdAnalysis && report.underAdAnalysis.length > 0) ? `<h2>📉 ${en ? 'Ads to Improve' : '需改善廣告分析'}</h2>${report.underAdAnalysis.map((a, i) => { const ad = matchAd(summary.underAds, a.ctr, i); const link = ad?.storyId ? `https://www.facebook.com/${ad.storyId}` : ''; return `<div class="post-card under"><div class="post-header">CTR ${a.ctr}%&nbsp;·&nbsp;「${titleOf(ad?.name, a.adSnippet)}⋯」${link ? ` &nbsp;<a href="${link}" style="color:inherit">${en ? 'View ad ↗' : '查看廣告 ↗'}</a>` : ''}</div><div>⚠️ ${en ? 'Issue: ' : '問題：'}${a.issue}</div><div class="post-pattern">🔧 ${en ? 'Suggestion: ' : '建議：'}${a.improvement}</div></div>` }).join('')}` : ''}

<h2>🎯 ${en ? 'Top 3 Action Items' : 'Top 3 行動建議'}</h2>
<ol>${report.topRecommendations.map(r => `<li>${r}</li>`).join('')}</ol>

<div class="footer">ContentLoop · ${en ? 'Insight Report' : '洞察報告'} · ${summary.period}</div>
</body></html>`
}

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_QUARTER = Math.ceil(CURRENT_MONTH / 3)
// Meta insights go back ~37 months, so offer the last 4 years (floored at 2023)
// — lets users view historical campaigns (e.g. data that only exists in 2023).
const YEARS = [CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR].filter(y => y >= 2023)

function StatusBadge({ status, lowerIsBetter = false }: { status: 'above' | 'below' | 'nodata'; lowerIsBetter?: boolean }) {
  const { L } = useLang()
  if (status === 'nodata') return <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#f3f4f6', color: '#9ca3af', fontWeight: 600 }}>{L('無資料', 'No data')}</span>
  const good = status === 'above'
  const label = lowerIsBetter ? (good ? L('較省 ✓', 'Cheaper ✓') : L('較貴 ↑', 'Pricier ↑')) : (good ? L('優於同業 ↑', 'Above peers ↑') : L('低於同業 ↓', 'Below peers ↓'))
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
function fingerprintOf(s: Summary, lang: string): string {
  const a = s.adsSummary, o = s.overview
  // v5: report language is part of the fingerprint — switching ZH⇄EN must
  // regenerate (the AI prose is language-specific), not serve a stale report.
  return ['v5', lang, a.ctr, a.cpc, a.cpm, a.spend, a.clicks, o.totalPosts, o.avgEngRate, o.followerGrowth].join('|')
}

// First/last calendar day (YYYY-MM-DD) of the selected report period — used to
// auto-sync ads for exactly the range the report will display.
function periodBounds(
  periodType: 'month' | 'quarter' | 'year',
  year: number, month: number, quarter: number,
): { since: string; until: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate() // m = 1-based
  if (periodType === 'year') return { since: `${year}-01-01`, until: `${year}-12-31` }
  if (periodType === 'quarter') {
    const sm = (quarter - 1) * 3 + 1, em = sm + 2
    return { since: `${year}-${pad(sm)}-01`, until: `${year}-${pad(em)}-${pad(lastDay(year, em))}` }
  }
  return { since: `${year}-${pad(month)}-01`, until: `${year}-${pad(month)}-${pad(lastDay(year, month))}` }
}

export function InsightsSection({ pageId, onAskAI }: { pageId: string; onAskAI?: (q: string) => void }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [periodType, setPeriodType] = useState<'month' | 'quarter' | 'year'>('month')
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [quarter, setQuarter] = useState(CURRENT_QUARTER)
  const [loading, setLoading] = useState(false)
  const [syncingAds, setSyncingAds] = useState(false)
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
          const freshFp = fingerprintOf(freshSummary, lang)
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
  }, [pageId, periodKey, periodType, year, month, quarter, lang])

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
      if (!idToken) throw new Error(L('請先登入', 'Please log in first'))
      const headers = { Authorization: `Bearer ${idToken}` }

      // Step 0: best-effort sync ads for the SELECTED report period, so the
      // report reflects the whole month/quarter/year. Without this, the ad
      // snapshot only covers whatever range the ads-dashboard header was last
      // synced with — which often won't match the report period (footgun).
      // Admins only; viewers get 403 → ignored. Failure never blocks the report.
      const { since, until } = periodBounds(periodType, year, month, quarter)
      setSyncingAds(true)
      try {
        await fetch('/api/ads/sync', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId, since, until }),
        })
      } catch { /* best-effort: report still generates from existing snapshot */ }
      setSyncingAds(false)

      // Build query params
      const params = new URLSearchParams({ pageId, periodType, year: String(year) })
      if (periodType === 'month') params.set('month', String(month))
      else if (periodType === 'quarter') params.set('quarter', String(quarter))

      // Step 1: fetch summary (recomputed live from the freshly-synced snapshot)
      const sumRes = await fetch(`/api/insights/summary?${params}`, { headers })
      if (!sumRes.ok) throw new Error(L('資料載入失敗', 'Failed to load data'))
      const sumData: Summary = await sumRes.json()
      setSummary(sumData)

      // Step 2: generate AI report
      const repRes = await fetch('/api/insights/report', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: sumData, language: lang }),
      })
      if (!repRes.ok) {
        const e = await repRes.json().catch(() => ({}))
        throw new Error(e.error ?? L('報告生成失敗', 'Report generation failed'))
      }
      const repData = await repRes.json()
      setReport(repData.report)
      setGeneratedAt(repData.generatedAt)
      setFromCache(false)

      // Step 3: save to cache (with data fingerprint for staleness detection)
      await fetch('/api/insights/cache', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, periodKey: sumData.periodKey, report: repData.report, summary: sumData, dataFingerprint: fingerprintOf(sumData, lang) }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : L('發生錯誤', 'An error occurred'))
    } finally {
      setLoading(false)
      setSyncingAds(false)
    }
  }

  const metricRow = (label: string, data: BenchmarkStatus, unit = '%', lowerIsBetter = false) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--ad-border)' }}>
      <span style={{ fontSize: 13, color: 'var(--ad-text2)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{data.value}{unit}</span>
        <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('同業', 'Peers')} {data.benchmark}{unit}</span>
        <StatusBadge status={data.status} lowerIsBetter={lowerIsBetter} />
      </div>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="ads-section-header">
        <span style={{ fontSize: 16 }}>📊</span>
        <span className="ads-section-title">{L('洞察報告', 'Insight Report')}</span>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Type toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ad-border)' }}>
          {(['month', 'quarter', 'year'] as const).map(p => (
            <button key={p} onClick={() => setPeriodType(p)}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: periodType === p ? 'var(--ad-blue)' : 'white', color: periodType === p ? 'white' : 'var(--ad-text2)', transition: 'all 0.15s' }}>
              {p === 'month' ? L('月', 'Month') : p === 'quarter' ? L('季', 'Quarter') : L('年', 'Year')}
            </button>
          ))}
        </div>

        {/* Year */}
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle}>
          {YEARS.map(y => <option key={y} value={y}>{en ? `${y}` : `${y}年`}</option>)}
        </select>

        {/* Month / Quarter (hidden for year) */}
        {periodType === 'month' && (
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{en ? new Date(2000, m - 1).toLocaleString('en-US', { month: 'short' }) : `${m}月`}</option>
            ))}
          </select>
        )}
        {periodType === 'quarter' && (
          <select value={quarter} onChange={e => setQuarter(Number(e.target.value))} style={selectStyle}>
            <option value={1}>{L('Q1（1-3月）', 'Q1 (Jan-Mar)')}</option>
            <option value={2}>{L('Q2（4-6月）', 'Q2 (Apr-Jun)')}</option>
            <option value={3}>{L('Q3（7-9月）', 'Q3 (Jul-Sep)')}</option>
            <option value={4}>{L('Q4（10-12月）', 'Q4 (Oct-Dec)')}</option>
          </select>
        )}

        {/* Generate / Regen button */}
        {!report && !cacheChecking && (
          <button onClick={() => generate()} disabled={loading}
            style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: loading ? '#94a3b8' : 'var(--ad-blue)', color: 'white', cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {syncingAds ? L('⋯ 同步廣告中', '⋯ Syncing ads') : loading ? L('⋯ 分析中', '⋯ Analyzing') : L('✨ 生成報告', '✨ Generate report')}
          </button>
        )}
        {report && (
          <>
            <button onClick={() => generate(true)} disabled={loading}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid var(--ad-border)', background: 'white', color: 'var(--ad-text2)', cursor: loading ? 'default' : 'pointer' }}>
              {syncingAds ? L('⋯ 同步廣告中', '⋯ Syncing ads') : loading ? L('⋯ 生成中', '⋯ Generating') : L('↻ 重新生成', '↻ Regenerate')}
            </button>
            {summary && (
              <button onClick={() => {
                const win = window.open('', '_blank')
                if (!win) return
                win.document.write(buildPrintHTML(summary, report, en))
                win.document.close()
                win.focus()
                setTimeout(() => win.print(), 400)
              }}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>
                📄 {L('匯出 PDF', 'Export PDF')}
              </button>
            )}
          </>
        )}

        {/* Status indicators */}
        {cacheChecking && <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('檢查快取⋯', 'Checking cache…')}</span>}
        {fromCache && !loading && validDate(generatedAt) && (
          <span style={{ fontSize: 11, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>
            {L('⚡ 快取載入 · ', '⚡ Cached · ')}{validDate(generatedAt)!.toLocaleDateString(en ? 'en-US' : 'zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {!fromCache && !loading && validDate(generatedAt) && (
          <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>
            {L('生成於 ', 'Generated ')}{validDate(generatedAt)!.toLocaleTimeString(en ? 'en-US' : 'zh-TW', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Period range banner — always selected month 1st → month-end (or today if not reached) */}
      {summary && (
        <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, fontSize: 12,
          background: summary.isPartial ? '#fffbeb' : '#f0f9ff',
          border: `1px solid ${summary.isPartial ? '#fcd34d' : '#bae6fd'}`,
          color: summary.isPartial ? '#92400e' : '#0369a1' }}>
          📅 {L('資料區間', 'Data range')} {summary.dateRange.start} ~ {summary.dateRange.end}
          {summary.isPartial && L('（本期尚未結束，統計至今日）', ' (period not over; counted through today)')}
        </div>
      )}

      {/* Stale cache: data changed since last report */}
      {staleCache && !loading && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd', fontSize: 12, color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>{L('🔄 數據已更新（與上次生成報告時不同），下方數字為最新；AI 文字分析需重新生成才會更新。', '🔄 Data has changed since the last report; the numbers below are current. Regenerate to update the AI text analysis.')}</span>
          <button onClick={() => generate(true)}
            style={{ flexShrink: 0, padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: 'var(--ad-blue)', color: 'white', cursor: 'pointer' }}>
            {L('✨ 重新生成', '✨ Regenerate')}
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
              <span style={{ fontSize: 14, fontWeight: 700 }}>{L('同業 Benchmark 比較', 'Industry Benchmark')}</span>
              {summary.optimizationGoal && (
                <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontWeight: 500 }}>
                  🎯 {GOAL_LABELS[summary.optimizationGoal]?.[en ? 'en' : 'zh'] ?? summary.optimizationGoal}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{L('基準：', 'Benchmark: ')}{industryLabel(summary.benchmarkIndustry, en)}</span>
          </div>
          {summary.benchmarkIndustrySet === false && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <span>{L('尚未設定產業類別，目前暫用「非營利組織 / 社群」的預設基準，比較可能不準。請到「設定」填寫產業類別，系統會自動換成該產業的同業 benchmark。', 'No industry set yet, so the "Nonprofit / Community" default benchmark is used and the comparison may be inaccurate. Set your industry in Settings and the system will switch to that industry\'s benchmark automatically.')}</span>
            </div>
          )}
          {metricRow(L('平均互動率（FB+IG）', 'Avg engagement (FB+IG)'), summary.benchmarkCompare.fb.engagementRate)}
          {metricRow(L('追蹤者成長率', 'Follower growth rate'), summary.benchmarkCompare.fb.followerGrowth)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adRoas') && (
            summary.conversionType === 'purchase' && summary.benchmarkCompare.fb.adRoas
              ? metricRow(L('廣告 ROAS', 'Ad ROAS'), summary.benchmarkCompare.fb.adRoas, 'x')
              : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--ad-border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--ad-text2)' }}>{L('廣告 ROAS', 'Ad ROAS')}</span>
                  <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('N/A · 需設定購買轉換追蹤', 'N/A · needs purchase-conversion tracking')}</span>
                </div>
              )
          )}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? ['adCtr']).includes('adCtr') && metricRow(L('廣告 CTR', 'Ad CTR'), summary.benchmarkCompare.fb.adCtr)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpc') && metricRow(L('廣告 CPA（每次行動成本）', 'Ad CPA (cost per action)'), summary.benchmarkCompare.fb.adCpc, '', true)}
          {(GOAL_AD_METRICS[summary.optimizationGoal] ?? []).includes('adCpm') && metricRow(L('廣告 CPM', 'Ad CPM'), summary.benchmarkCompare.fb.adCpm, '', true)}
          {summary.optimizationGoal === 'conversion' && summary.conversionType !== 'purchase' && (
            <div style={{ fontSize: 10, color: 'var(--ad-text3)', marginTop: 6 }}>
              {L('※ 此活動為連結點擊目標，無購買營收追蹤，故 ROAS 無法計算；可參考廣告 CPA（每次行動成本）與點擊效益評估投放成效。', '※ This campaign optimizes for link clicks with no purchase-revenue tracking, so ROAS cannot be computed; use Ad CPA (cost per action) and click value to assess performance.')}
            </div>
          )}
          {summary.adsDateRange && (summary.adsDateRange.start !== summary.dateRange.start || summary.adsDateRange.end !== summary.dateRange.end) && (
            <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 6 }}>
              {L(`※ 廣告數據實際涵蓋 ${summary.adsDateRange.start} ~ ${summary.adsDateRange.end}（此區間有投放數據；如需補齊請調整表頭日期重新同步）`, `※ Ad data actually covers ${summary.adsDateRange.start} ~ ${summary.adsDateRange.end} (this range has delivery data; adjust the header dates and re-sync to fill gaps)`)}
            </div>
          )}
        </div>
      )}

      {/* Stats cards — two rows */}
      {summary && (
        <>
          {/* Row 1: Organic */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ad-text3)', marginBottom: 6, letterSpacing: '0.05em' }}>{L('有機貼文', 'Organic posts')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            {[
              { label: L('發文數', 'Posts'), value: String(summary.overview.totalPosts), unit: summary.overview.fbCount != null ? L(`則（FB ${summary.overview.fbCount}・IG ${summary.overview.igCount ?? 0}）`, ` (FB ${summary.overview.fbCount} · IG ${summary.overview.igCount ?? 0})`) : L('則', '') },
              { label: L('平均互動率', 'Avg engagement'), value: `${summary.overview.avgEngRate}%`, unit: '' },
              { label: L('平均觸及', 'Avg reach'), value: summary.overview.avgReach.toLocaleString(), unit: L('人', '') },
              { label: L('追蹤成長', 'Follower growth'), value: `+${summary.overview.followerGrowth}`, unit: L('人', '') },
            ].map(c => (
              <div key={c.label} style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{c.value}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ad-text3)', marginLeft: 2 }}>{c.unit}</span></div>
              </div>
            ))}
          </div>
          {/* Row 2: Ads */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ad-text3)', marginBottom: 6, letterSpacing: '0.05em' }}>{L('廣告投放', 'Ad delivery')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {([
              { label: L('廣告 CTR', 'Ad CTR'), value: `${summary.adsSummary.ctr}%`, unit: '' },
              { label: L('廣告 CPA', 'Ad CPA'), value: `$${Number(summary.adsSummary.cpc).toFixed(2)}`, unit: '' },
              { label: L('廣告 CPM', 'Ad CPM'), value: `$${Number(summary.adsSummary.cpm).toFixed(2)}`, unit: '' },
              { label: L('總花費', 'Total spend'), value: `$${Number(summary.adsSummary.spend).toLocaleString()}`, unit: '' },
              { label: L('連結點擊數', 'Link clicks'), value: summary.adsSummary.clicks.toLocaleString(), unit: L('次', '') },
              { label: L('點擊效益', 'Click value'), value: summary.adsSummary.spend > 0 ? ((summary.adsSummary.clicks / summary.adsSummary.spend) * 100).toFixed(2) : '0', unit: L('次/百元', '/NT$100'), tip: L('點擊效益＝每花 NT$100 取得的連結點擊次數，並非 ROAS。真正的 ROAS（營收÷花費）需設定購買轉換追蹤才能計算。', 'Click value = link clicks per NT$100 spent, not ROAS. True ROAS (revenue ÷ spend) requires purchase-conversion tracking.') },
              { label: L('觸及人數', 'Reach'), value: summary.adsSummary.reach > 0 ? (en ? (summary.adsSummary.reach / 1000).toFixed(1) + 'K' : (summary.adsSummary.reach / 10000).toFixed(1) + '萬') : '-', unit: '' },
              { label: L('頻率', 'Frequency'), value: String(summary.adsSummary.frequency), unit: '' },
              { label: L('廣告數', 'Ads'), value: String(summary.adsSummary.adCount), unit: L('則', '') },
            ] as { label: string; value: string; unit: string; tip?: string }[]).map(c => (
              <div key={c.label} title={c.tip} style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4 }}>{c.label}{c.tip && <span style={{ marginLeft: 4, cursor: 'help' }} title={c.tip}>ⓘ</span>}</div>
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
              <span style={{ fontSize: 13, fontWeight: 700 }}>{L('執行摘要', 'Executive Summary')}</span>
              {onAskAI && <button className="ads-diag-ask-btn" style={{ marginLeft: 'auto' }} onClick={() => onAskAI(L(`根據本期洞察報告：${report.executiveSummary}，請給我3個具體的下一步行動建議`, `Based on this period's insight report: ${report.executiveSummary}, give me 3 specific next-step actions`))}>{L('問 AI ›', 'Ask AI ›')}</button>}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, color: 'var(--ad-text2)' }}>{report.executiveSummary}</p>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🏆 {L('同業比較洞察', 'Benchmark Insight')}</div>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', lineHeight: 1.7, margin: 0 }}>{report.benchmarkInsight}</p>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>🌟 {L('表現最佳貼文分析', 'Top Post Analysis')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.topPostAnalysis.map((p, i) => {
                const post = matchPost(summary.topPosts, p.engRate, i, p.postSnippet)
                const link = post?.permalink || ''
                return (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{L('互動率', 'Engagement')} {p.engRate}% &nbsp;·&nbsp; 「{titleOf(post?.message, p.postSnippet)}⋯」</span>
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#16a34a', fontWeight: 700, textDecoration: 'none' }}>{L('查看貼文 ↗', 'View post ↗')}</a>}
                  </div>
                  <div style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>💡 {p.whyItWorked}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>📌 {L('可複製模式：', 'Replicable pattern: ')}{p.replicablePattern}</div>
                </div>
                )
              })}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 {L('需改善貼文分析', 'Posts to Improve')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.underPerformerAnalysis.map((p, i) => {
                const post = matchPost(summary.underPosts, p.engRate, i, p.postSnippet)
                const link = post?.permalink || ''
                return (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74' }}>
                  <div style={{ fontSize: 12, color: '#c2410c', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{L('互動率', 'Engagement')} {p.engRate}% &nbsp;·&nbsp; 「{titleOf(post?.message, p.postSnippet)}⋯」</span>
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#ea580c', fontWeight: 700, textDecoration: 'none' }}>{L('查看貼文 ↗', 'View post ↗')}</a>}
                  </div>
                  <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 4 }}>⚠️ {L('問題：', 'Issue: ')}{p.issue}</div>
                  <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 500 }}>🔧 {L('建議：', 'Suggestion: ')}{p.improvement}</div>
                </div>
                )
              })}
            </div>
          </div>

          {/* A/B test insight */}
          {report.abTestInsight && (
            <div style={{ background: '#faf5ff', borderRadius: 10, border: '1px solid #d8b4fe', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#7c3aed' }}>🧪 {L('A/B 測試洞察', 'A/B Test Insight')}</div>
              <p style={{ fontSize: 13, color: '#6b21a8', lineHeight: 1.7, margin: 0 }}>{report.abTestInsight}</p>
            </div>
          )}

          {/* Best ads (single ad → just "廣告分析") */}
          {report.topAdAnalysis && report.topAdAnalysis.length > 0 && (
            <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                {report.topAdAnalysis.length === 1 && (!report.underAdAnalysis || report.underAdAnalysis.length === 0) ? L('📊 廣告分析', '📊 Ad Analysis') : L('🏆 表現最佳廣告分析', '🏆 Top Ad Analysis')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {report.topAdAnalysis.map((a, i) => {
                  const ad = matchAd(summary.topAds, a.ctr, i)
                  const link = ad?.storyId ? `https://www.facebook.com/${ad.storyId}` : ''
                  return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd' }}>
                    <div style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>CTR {a.ctr}% &nbsp;·&nbsp; 「{titleOf(ad?.name, a.adSnippet)}⋯」</span>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}>{L('查看廣告 ↗', 'View ad ↗')}</a>}
                    </div>
                    <div style={{ fontSize: 12, color: '#1e40af', marginBottom: 4 }}>💡 {a.whyItWorked}</div>
                    <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 500 }}>📌 {L('可複製模式：', 'Replicable pattern: ')}{a.replicablePattern}</div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Worst ads */}
          {report.underAdAnalysis && report.underAdAnalysis.length > 0 && (
            <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📉 {L('需改善廣告分析', 'Ads to Improve')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {report.underAdAnalysis.map((a, i) => {
                  const ad = matchAd(summary.underAds, a.ctr, i)
                  const link = ad?.storyId ? `https://www.facebook.com/${ad.storyId}` : ''
                  return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5' }}>
                    <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>CTR {a.ctr}% &nbsp;·&nbsp; 「{titleOf(ad?.name, a.adSnippet)}⋯」</span>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#dc2626', fontWeight: 700, textDecoration: 'none' }}>{L('查看廣告 ↗', 'View ad ↗')}</a>}
                    </div>
                    <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 4 }}>⚠️ {L('問題：', 'Issue: ')}{a.issue}</div>
                    <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>🔧 {L('建議：', 'Suggestion: ')}{a.improvement}</div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ background: 'white', borderRadius: 10, border: '1px solid var(--ad-border)', padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🎯 {L('本期 Top 3 行動建議', 'Top 3 Action Items')}</div>
            <ol style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {report.topRecommendations.map((r, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--ad-text2)', lineHeight: 1.6 }}>{r}</li>
              ))}
            </ol>
            {onAskAI && (
              <button className="ads-btn" style={{ marginTop: 12, fontSize: 12 }}
                onClick={() => onAskAI(L(`我想深入了解這份洞察報告的行動建議：${report.topRecommendations.join('；')}，幫我規劃下週的內容計畫`, `I want to dig into this report's action items: ${report.topRecommendations.join('; ')} — help me plan next week's content`))}>
                ✨ {L('請 AI 規劃下週內容', 'Ask AI to plan next week')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
