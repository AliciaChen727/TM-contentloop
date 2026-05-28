'use client'

import { SvgChart } from '../SvgCharts'
import { Icon } from '../Icon'
import { POSTS_DATA } from '../mockData'
import type { AdData, Post } from '../types'

const fmt = (n: number, d = 0) => n == null ? '–' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtK = (n: number) => n >= 10000 ? `$${fmt(Math.round(n / 1000))}K` : `$${fmt(n)}`
const fmtCount = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}萬` : n >= 1000 ? `${(n / 1000).toFixed(1)}千` : `${fmt(n)}`

// Platform source (FB / IG) — moved here from the audience-analysis tab.
const PLATFORM_ORDER = ['facebook', 'instagram', 'other']
const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', other: '其他版位 (Audience Network / Messenger)' }
type PlatCell = { key: string; label: string; kind: 'currency' | 'int' | 'percent' | 'ratio' }
const platCols = (hasPurchase: boolean): PlatCell[] => {
  const base: PlatCell[] = [
    { key: 'spend', label: '花費', kind: 'currency' },
    { key: 'clicks', label: '點擊', kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'roas', label: 'ROAS', kind: 'ratio' },
  ]
  if (hasPurchase) base.push(
    { key: 'revenue', label: 'Revenue', kind: 'currency' },
    { key: 'conversions', label: '轉換', kind: 'int' },
    { key: 'cpp', label: 'Cost / Purchase', kind: 'currency' },
  )
  return base
}
const fmtPlat = (v: number, kind: PlatCell['kind']) =>
  kind === 'currency' ? `$${Math.round(v).toLocaleString('zh-TW')}`
  : kind === 'percent' ? `${v.toFixed(2)}%`
  : kind === 'ratio' ? v.toFixed(2)
  : Math.round(v).toLocaleString('zh-TW')

export type OptimizationGoal = 'clicks' | 'conversion' | 'reach' | 'event'

// 3 leading KPI ids per optimization goal. Cards not listed retain original order behind these.
const GOAL_PRIORITY: Record<OptimizationGoal, string[]> = {
  clicks: ['ctr', 'cpc', 'link_clicks'],
  conversion: ['roas', 'cpa', 'conversions'],
  reach: ['reach', 'cpm', 'impressions'],
  event: ['ctr', 'cpl', 'link_page_views'],
}

export function OverviewSection({ data, onAskAI, posts, optimizationGoal }: { data: AdData; onAskAI?: (q: string) => void; posts?: Post[] | null; optimizationGoal?: OptimizationGoal | null }) {
  const s = data.overview.summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convType = (data as any).conversionType as string | undefined
  const isClickBased = convType === 'link_click'
  const isVideoBased = convType === 'video_view'
  const budgetPct = (s.spend / data.budget.total) * 100
  const roasLabel = isVideoBased ? '觀看效益' : isClickBased ? '點擊效益' : 'CPA'
  const roasUnit = isVideoBased || isClickBased ? '次/百元' : 'x'
  const cpaLabel = isVideoBased ? 'CPV' : isClickBased ? 'CPC' : 'CPA'
  const cpaQ = isVideoBased ? 'CPV 如何進一步降低？' : isClickBased ? 'CPC 如何進一步降低？' : 'CPA 如何進一步降低？'
  const convLabel = isVideoBased ? '影片觀看' : isClickBased ? '點擊數' : '轉換數'
  const convMeta = isVideoBased ? '影片觀看次數' : isClickBased ? '連結點擊次數' : `營收 ${fmtK(s.revenue ?? 0)}`
  const roas = s.roas ?? 0
  const frequency = s.frequency ?? 0
  const reach = s.reach ?? 0
  const impressions = s.impressions ?? 0
  // Derived metrics — for goals that ask for fields the API doesn't expose, fall back
  // to closest available signal. conversionType=link_click means s.conversions == link clicks.
  const linkClicks = isClickBased ? (s.conversions ?? 0) : 0
  const cpl = linkClicks > 0 ? (s.spend ?? 0) / linkClicks : 0
  const cards: Record<string, { label: string; value: string; meta: string; color: string; delta: string; dir: string; q: string }> = {
    roas: { label: roasLabel, value: roas.toFixed(2) + roasUnit, meta: `目標 ${s.roasTarget}${roasUnit}`, color: roas >= s.roasTarget ? 'green' : 'orange', delta: s.roasTarget > 0 ? `${roas >= s.roasTarget ? '+' : ''}${((roas - s.roasTarget) / s.roasTarget * 100).toFixed(0)}%` : '', dir: roas >= s.roasTarget ? 'up' : 'down', q: isVideoBased ? '影片廣告效益如何提升？' : isClickBased ? '廣告點擊效益如何提升？' : 'CPA 如何降低？' },
    spend: { label: '總花費', value: fmtK(s.spend ?? 0), meta: `預算 ${fmtK(data.budget.total)}`, color: 'blue', delta: `${budgetPct.toFixed(0)}%`, dir: 'neutral', q: '預算怎麼分配最划算？' },
    cpa: { label: cpaLabel, value: `$${fmt(s.cpa ?? 0)}`, meta: `目標 $${fmt(s.cpaTarget ?? 0)}`, color: (s.cpa ?? 0) > 0 && (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'green' : 'orange', delta: (s.cpa ?? 0) > 0 && (s.cpaTarget ?? 0) > 0 ? ((s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? `-${(((s.cpaTarget ?? 0) - (s.cpa ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%` : `+${(((s.cpa ?? 0) - (s.cpaTarget ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%`) : '', dir: (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'up' : 'down', q: cpaQ },
    ctr: { label: 'CTR', value: `${fmt(s.ctr ?? 0, 2)}%`, meta: '業界均值 1.8%', color: 'blue', delta: '+19%', dir: 'up', q: '哪支素材表現最好？' },
    cpc: { label: 'CPC', value: `$${fmt(s.cpa ?? 0, 2)}`, meta: '每次點擊成本', color: 'blue', delta: '', dir: 'neutral', q: 'CPC 如何降低？' },
    cpm: { label: 'CPM', value: `$${fmt(s.cpm ?? 0, 2)}`, meta: '千次曝光', color: 'orange', delta: '', dir: 'neutral', q: 'CPM 為什麼上升？' },
    reach: { label: '觸及人數', value: fmtCount(reach), meta: `曝光 ${fmtCount(impressions)} 次`, color: 'blue', delta: '', dir: 'neutral', q: '如何擴大觸及？' },
    impressions: { label: '曝光次數', value: fmtCount(impressions), meta: `觸及 ${fmtCount(reach)} 人`, color: 'blue', delta: '', dir: 'neutral', q: '曝光與觸及的差距代表什麼？' },
    conversions: { label: convLabel, value: fmt(s.conversions ?? 0), meta: convMeta, color: 'green', delta: '', dir: 'neutral', q: '哪個組合轉換最好？' },
    link_clicks: { label: '連結點擊數', value: isClickBased ? fmt(linkClicks) : '–', meta: isClickBased ? '已點擊連結次數' : '需設定為連結點擊目標', color: 'blue', delta: '', dir: 'neutral', q: '怎麼提升連結點擊？' },
    cpl: { label: 'CPL', value: cpl > 0 ? `$${fmt(cpl, 2)}` : '–', meta: '每次報名點擊成本', color: 'orange', delta: '', dir: 'neutral', q: 'CPL 如何降低？' },
    link_page_views: { label: '連結頁面瀏覽', value: isClickBased ? fmt(linkClicks) : '–', meta: isClickBased ? '連結頁面瀏覽次數' : '需設定為連結點擊目標', color: 'blue', delta: '', dir: 'neutral', q: '連結頁面瀏覽如何提升？' },
    frequency: { label: '頻率', value: frequency.toFixed(2), meta: '建議 < 3.5', color: frequency > 3.5 ? 'red' : 'green', delta: frequency > 3.5 ? '⚠ 偏高' : '正常', dir: frequency > 3.5 ? 'down' : 'up', q: '我的受眾是否疲乏了？' },
  }

  // Default order (used when no onboarding goal selected) preserves prior layout.
  const defaultOrder = ['roas', 'spend', 'cpa', 'ctr', 'cpm', 'reach', 'conversions', 'frequency']
  const lead = optimizationGoal ? GOAL_PRIORITY[optimizationGoal] : []
  const tail = defaultOrder.filter(id => !lead.includes(id))
  const orderedIds = [...lead, ...tail]
  const kpis = orderedIds.map(id => cards[id]).filter(Boolean)

  const hasPurchase = convType === 'purchase'
  const platformCols = platCols(hasPurchase)
  const platformRows = PLATFORM_ORDER
    .map(platform => {
      const p = (data.platformBreakdown ?? []).find(x => x.platform === platform)
      const spend = p?.spend ?? 0, clicks = p?.clicks ?? 0, impressions = p?.impressions ?? 0, conversions = p?.conversions ?? 0, revenue = p?.revenue ?? 0
      return {
        label: PLATFORM_LABEL[platform] ?? platform, spend, clicks, impressions, conversions, revenue,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        roas: spend > 0 ? (hasPurchase ? revenue / spend : (conversions / spend) * 100) : 0,
        cpp: conversions > 0 ? spend / conversions : 0,
      }
    })
    .filter(r => r.spend > 0 || r.impressions > 0)

  const postsSource = posts ?? POSTS_DATA
  const adPosts = postsSource.filter(p => p.hasAd)
  const reachPosts = postsSource.filter(p => (p.reach ?? 0) > 0)
  const avgReach = reachPosts.length > 0 ? Math.round(reachPosts.reduce((s, p) => s + (p.reach ?? 0), 0) / reachPosts.length) : 0
  const topReach = reachPosts.length > 0 ? Math.max(...reachPosts.map(p => p.reach ?? 0)) : 0
  const top3 = [...reachPosts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 3)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chart" size={15} color="var(--ad-blue)" />
          <span style={{ fontSize: 15, fontWeight: 700 }}>整體表現總覽</span>
        </div>
        <div className="ads-date-pill"><Icon name="calendar" size={12} />{data.overview.dateRange}</div>
      </div>

      <div className="ads-kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className={`ads-kpi-card ${k.color}`}>
            {onAskAI && <button className="ads-kpi-ask-btn" onClick={() => onAskAI(k.q)}>?</button>}
            <div className="ads-kpi-label">{k.label}</div>
            <div className="ads-kpi-value">{k.value}</div>
            <div className="ads-kpi-meta">
              <span>{k.meta}</span>
              {k.delta && <span className={`ads-kpi-delta ${k.dir}`}>{k.delta}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="ads-card ads-card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>月度預算進度</span>
          <span style={{ fontSize: 12, color: 'var(--ad-text3)', fontFamily: 'var(--font-dm-mono)' }}>{fmtK(s.spend)} / {fmtK(data.budget.total)}</span>
        </div>
        <div className="ads-budget-bar-wrap">
          <div className="ads-budget-bar-fill" style={{ width: `${budgetPct}%`, background: budgetPct > 95 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ad-text3)' }}>
          <span>{budgetPct.toFixed(1)}% 已使用</span>
          <span>剩餘 {fmtK(data.budget.remaining)} · 預計月底 {fmtK(data.budget.projectedSpend)}</span>
        </div>
      </div>

      <div className="ads-grid-2">
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>每日花費 vs 點擊數</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'clicks', label: '點擊數', color: '#3B6FD4', isInt: true }, { key: 'spend', label: '花費', color: '#2E8B57', isCurr: true }]} />
        </div>
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{isVideoBased ? '每日觀看效益趨勢' : isClickBased ? '每日點擊效益趨勢' : '每日 CPA 趨勢'}</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'roas', label: isClickBased ? '點擊效益' : 'CPA', color: '#3B6FD4' }]} />
        </div>
      </div>

      {platformRows.length > 0 && (
        <div className="ads-card" style={{ overflow: 'hidden', marginTop: 16 }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>平台來源（FB / IG）</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ad-border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--ad-text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>平台</th>
                  {platformCols.map(c => (
                    <th key={c.key} style={{ textAlign: 'right', padding: '10px 16px', color: 'var(--ad-text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {platformRows.map((row, ri) => {
                  const vals = row as unknown as Record<string, number>
                  return (
                    <tr key={row.label} style={{ borderBottom: ri < platformRows.length - 1 ? '1px solid var(--ad-border)' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.label}</td>
                      {platformCols.map(c => (
                        <td key={c.key} style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtPlat(vals[c.key] ?? 0, c.kind)}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="calendar" size={15} color="var(--ad-blue)" />
          <span style={{ fontSize: 14, fontWeight: 700 }}>內容表現摘要</span>
          <span style={{ fontSize: 11.5, color: 'var(--ad-text3)' }}>過去 30 天 · {postsSource.length} 篇貼文</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: '最高觸及', value: String(topReach), sub: top3[0] ? `${top3[0].date} ${top3[0].type}` : '—', color: 'var(--ad-blue)' },
            { label: '平均觸及', value: String(avgReach), sub: '自然觸及', color: 'var(--ad-blue)' },
            { label: '平均互動率', value: reachPosts.length > 0 ? `${(reachPosts.reduce((acc, p) => acc + ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100), 0) / reachPosts.length).toFixed(2)}%` : '—', sub: '(讚+留言+分享)/觸及', color: 'var(--ad-green)' },
            { label: '有廣告加持', value: `${adPosts.length} 篇`, sub: adPosts.length > 0 ? `最低 CPA $${Math.min(...adPosts.filter(p => (p.adCpa ?? 0) > 0).map(p => p.adCpa ?? 999)).toFixed(2)}` : '尚無廣告數據', color: 'var(--ad-orange)' },
          ].map(s => (
            <div key={s.label} className="ads-card ads-card-pad" style={{ borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ad-text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-dm-mono)', margin: '4px 0 2px', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div className="ads-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)', fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>🏆 觸及率 Top 3 貼文</div>
          {top3.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--ad-text3)', fontSize: 12.5 }}>暫無觸及資料</div>
          ) : top3.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < top3.length - 1 ? '1px solid var(--ad-border)' : 'none' }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'var(--ad-green)' : i === 1 ? 'var(--ad-blue)' : 'var(--ad-surface2)', color: i < 2 ? 'white' : 'var(--ad-text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 1 }}>{p.date} · {p.platform} · {p.type}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ad-blue)', fontFamily: 'var(--font-dm-mono)' }}>{fmt(p.reach ?? 0)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ad-text3)' }}>觸及</div>
              </div>
              {p.hasAd && p.adCpa != null && p.adCpa > 0 && <span className="ads-posts-ad-badge">🎯 CPA ${p.adCpa}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
