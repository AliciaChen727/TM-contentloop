'use client'

import { SvgChart } from '../SvgCharts'
import { Icon } from '../Icon'
import { POSTS_DATA } from '../mockData'
import type { AdData, Post } from '../types'
import { useLang } from '@/lib/i18n/LanguageProvider'

const fmt = (n: number, d = 0) => n == null ? '–' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtK = (n: number) => n >= 10000 ? `$${fmt(Math.round(n / 1000))}K` : `$${fmt(n)}`
const fmtCount = (n: number, en = false) => en
  ? (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${fmt(n)}`)
  : (n >= 10000 ? `${(n / 10000).toFixed(1)}萬` : n >= 1000 ? `${(n / 1000).toFixed(1)}千` : `${fmt(n)}`)

// Platform source (FB / IG) — moved here from the audience-analysis tab.
const PLATFORM_ORDER = ['facebook', 'instagram', 'other']
const platformLabel = (k: string, en: boolean): string =>
  k === 'facebook' ? 'Facebook' : k === 'instagram' ? 'Instagram'
  : (en ? 'Other placements (Audience Network / Messenger)' : '其他版位 (Audience Network / Messenger)')
type PlatCell = { key: string; label: string; kind: 'currency' | 'int' | 'percent' | 'ratio' }
const platCols = (hasPurchase: boolean, en: boolean): PlatCell[] => {
  const base: PlatCell[] = [
    { key: 'spend', label: en ? 'Spend' : '花費', kind: 'currency' },
    { key: 'clicks', label: en ? 'Clicks' : '點擊', kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'roas', label: 'ROAS', kind: 'ratio' },
  ]
  if (hasPurchase) base.push(
    { key: 'revenue', label: 'Revenue', kind: 'currency' },
    { key: 'conversions', label: en ? 'Conversions' : '轉換', kind: 'int' },
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
  conversion: ['roasReal', 'roas', 'cpa', 'conversions'],
  reach: ['reach', 'cpm', 'impressions'],
  event: ['ctr', 'cpl', 'link_page_views'],
}

export function OverviewSection({ data, onAskAI, posts, optimizationGoal }: { data: AdData; onAskAI?: (q: string) => void; posts?: Post[] | null; optimizationGoal?: OptimizationGoal | null }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const s = data.overview.summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convType = (data as any).conversionType as string | undefined
  const isClickBased = convType === 'link_click'
  const isVideoBased = convType === 'video_view'
  const budgetPct = (s.spend / data.budget.total) * 100
  const roasLabel = isVideoBased ? L('觀看效益', 'View value') : isClickBased ? L('點擊效益', 'Click value') : 'CPA'
  const roasUnit = isVideoBased || isClickBased ? L('次/百元', '/NT$100') : 'x'
  // The dedicated `cpc` card already shows cost-per-click; this `cpa` card is the
  // cost-per-action/registration (with target). Label it CPA to avoid a duplicate CPC.
  const cpaLabel = isVideoBased ? 'CPV' : 'CPA'
  const cpaQ = isVideoBased ? L('CPV 如何進一步降低？', 'How can I lower CPV further?') : L('CPA 如何進一步降低？', 'How can I lower CPA further?')
  const convLabel = isVideoBased ? L('影片觀看', 'Video views') : L('轉換數', 'Conversions')
  const convMeta = isVideoBased ? L('影片觀看次數', 'Video view count') : isClickBased ? L('連結點擊次數', 'Link click count') : L(`營收 ${fmtK(s.revenue ?? 0)}`, `Revenue ${fmtK(s.revenue ?? 0)}`)
  const roas = s.roas ?? 0
  const frequency = s.frequency ?? 0
  const reach = s.reach ?? 0
  const impressions = s.impressions ?? 0
  // Derived metrics — for goals that ask for fields the API doesn't expose, fall back
  // to closest available signal. conversionType=link_click means s.conversions == link clicks.
  const linkClicks = isClickBased ? (s.conversions ?? 0) : 0
  const cpl = linkClicks > 0 ? (s.spend ?? 0) / linkClicks : 0
  const roasTip = isVideoBased
    ? L('觀看效益＝每花 NT$100 取得的影片觀看次數，並非 ROAS。真正的 ROAS（營收÷花費）需設定購買轉換追蹤才能計算。', 'View value = video views per NT$100 spent, not ROAS. True ROAS (revenue ÷ spend) requires purchase-conversion tracking.')
    : isClickBased
      ? L('點擊效益＝每花 NT$100 取得的連結點擊次數，並非 ROAS。真正的 ROAS（營收÷花費）需設定購買轉換追蹤才能計算。', 'Click value = link clicks per NT$100 spent, not ROAS. True ROAS (revenue ÷ spend) requires purchase-conversion tracking.')
      : L('ROAS＝廣告營收 ÷ 廣告花費，需有購買轉換追蹤的營收資料。', 'ROAS = ad revenue ÷ ad spend; requires revenue data from purchase-conversion tracking.')

  // No accessible ad data in range → fall back the 觸及人數 card to organic post
  // reach (clearly labelled), instead of a meaningless 0. Other ad-only cards
  // (花費/CPM/CPA) stay 0 — they have no organic equivalent.
  const postsSource = posts ?? POSTS_DATA
  const reachPosts = postsSource.filter(p => (p.reach ?? 0) > 0)
  const totalOrganicReach = reachPosts.reduce((acc, p) => acc + (p.reach ?? 0), 0)
  const noAdData = (s.spend ?? 0) <= 0 && (s.impressions ?? 0) <= 0

  const cards: Record<string, { label: string; value: string; meta: string; color: string; delta: string; dir: string; q: string; tip?: string }> = {
    roas: { label: roasLabel, value: roas.toFixed(2) + roasUnit, meta: L(`目標 ${s.roasTarget}${roasUnit}`, `Target ${s.roasTarget}${roasUnit}`), color: roas >= s.roasTarget ? 'green' : 'orange', delta: s.roasTarget > 0 ? `${roas >= s.roasTarget ? '+' : ''}${((roas - s.roasTarget) / s.roasTarget * 100).toFixed(0)}%` : '', dir: roas >= s.roasTarget ? 'up' : 'down', q: isVideoBased ? L('影片廣告效益如何提升？', 'How can I improve video ad performance?') : isClickBased ? L('廣告點擊效益如何提升？', 'How can I improve ad click value?') : L('CPA 如何降低？', 'How can I lower CPA?'), tip: roasTip },
    spend: { label: L('總花費', 'Total spend'), value: fmtK(s.spend ?? 0), meta: L(`預算 ${fmtK(data.budget.total)}`, `Budget ${fmtK(data.budget.total)}`), color: 'blue', delta: `${budgetPct.toFixed(0)}%`, dir: 'neutral', q: L('預算怎麼分配最划算？', "What's the most cost-effective budget split?") },
    cpa: { label: cpaLabel, value: `$${fmt(s.cpa ?? 0)}`, meta: L(`目標 $${fmt(s.cpaTarget ?? 0)}`, `Target $${fmt(s.cpaTarget ?? 0)}`), color: (s.cpa ?? 0) > 0 && (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'green' : 'orange', delta: (s.cpa ?? 0) > 0 && (s.cpaTarget ?? 0) > 0 ? ((s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? `-${(((s.cpaTarget ?? 0) - (s.cpa ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%` : `+${(((s.cpa ?? 0) - (s.cpaTarget ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%`) : '', dir: (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'up' : 'down', q: cpaQ },
    ctr: { label: 'CTR', value: `${fmt(s.ctr ?? 0, 2)}%`, meta: L('業界均值 1.8%', 'Industry avg 1.8%'), color: 'blue', delta: '+19%', dir: 'up', q: L('哪支素材表現最好？', 'Which creative performs best?') },
    cpc: { label: 'CPC', value: `$${fmt((s.clicks ?? 0) > 0 ? (s.spend ?? 0) / (s.clicks ?? 1) : 0, 2)}`, meta: L('每次點擊成本（含互動）', 'Cost per click (incl. engagement)'), color: 'blue', delta: '', dir: 'neutral', q: L('CPC 如何降低？', 'How can I lower CPC?') },
    cpm: { label: 'CPM', value: `$${fmt(s.cpm ?? 0, 2)}`, meta: L('千次曝光', 'Per 1,000 impressions'), color: 'orange', delta: '', dir: 'neutral', q: L('CPM 為什麼上升？', 'Why is CPM rising?') },
    reach: noAdData
      ? { label: L('觸及人數', 'Reach'), value: fmtCount(totalOrganicReach, en), meta: L('自然貼文觸及（無廣告）', 'Organic post reach (no ads)'), color: 'blue', delta: '', dir: 'neutral', q: L('如何擴大自然觸及？', 'How can I expand organic reach?'), tip: L('此粉專所選區間無廣告數據，這裡顯示的是自然貼文的總觸及人數。', 'No ad data for this page in the selected range; this shows the total organic post reach.') }
      : { label: L('觸及人數', 'Reach'), value: fmtCount(reach, en), meta: L(`曝光 ${fmtCount(impressions, en)} 次`, `${fmtCount(impressions, en)} impressions`), color: 'blue', delta: '', dir: 'neutral', q: L('如何擴大觸及？', 'How can I expand reach?') },
    impressions: { label: L('曝光次數', 'Impressions'), value: fmtCount(impressions, en), meta: L(`觸及 ${fmtCount(reach, en)} 人`, `${fmtCount(reach, en)} reached`), color: 'blue', delta: '', dir: 'neutral', q: L('曝光與觸及的差距代表什麼？', 'What does the gap between impressions and reach mean?') },
    conversions: { label: convLabel, value: fmt(s.conversions ?? 0), meta: convMeta, color: 'green', delta: '', dir: 'neutral', q: L('哪個組合轉換最好？', 'Which ad set converts best?'), tip: isVideoBased ? L('此活動為影片觀看目標，顯示影片觀看次數（非轉換率）。', 'This campaign optimizes for video views; shows view count (not conversion rate).') : isClickBased ? L('此活動為連結點擊目標，「轉換」即連結點擊，故顯示點擊次數（非轉換率）。真正的購買轉換需設定轉換追蹤。', 'This campaign optimizes for link clicks, so "conversions" = link clicks (count, not rate). True purchase conversions require conversion tracking.') : L('購買轉換次數（非轉換率）。', 'Purchase conversion count (not rate).') },
    link_clicks: { label: L('連結點擊數', 'Link clicks'), value: isClickBased ? fmt(linkClicks) : '–', meta: isClickBased ? L('已點擊連結次數', 'Link clicks count') : L('需設定為連結點擊目標', 'Requires link-click objective'), color: 'blue', delta: '', dir: 'neutral', q: L('怎麼提升連結點擊？', 'How can I boost link clicks?') },
    cpl: { label: 'CPL', value: cpl > 0 ? `$${fmt(cpl, 2)}` : '–', meta: L('每次報名點擊成本', 'Cost per sign-up click'), color: 'orange', delta: '', dir: 'neutral', q: L('CPL 如何降低？', 'How can I lower CPL?') },
    link_page_views: { label: L('連結頁面瀏覽', 'Link page views'), value: isClickBased ? fmt(linkClicks) : '–', meta: isClickBased ? L('連結頁面瀏覽次數', 'Link page view count') : L('需設定為連結點擊目標', 'Requires link-click objective'), color: 'blue', delta: '', dir: 'neutral', q: L('連結頁面瀏覽如何提升？', 'How can I increase link page views?') },
    frequency: { label: L('頻率', 'Frequency'), value: frequency.toFixed(2), meta: L('建議 < 3.5', 'Recommended < 3.5'), color: frequency > 3.5 ? 'red' : 'green', delta: frequency > 3.5 ? L('⚠ 偏高', '⚠ High') : L('正常', 'Normal'), dir: frequency > 3.5 ? 'down' : 'up', q: L('我的受眾是否疲乏了？', 'Is my audience fatiguing?') },
    // Dedicated real-ROAS card. Only meaningful for purchase campaigns with revenue
    // tracking; otherwise shows N/A + how to enable it (don't fake a ROAS number).
    roasReal: (convType === 'purchase' && roas > 0)
      ? { label: 'ROAS', value: `${roas.toFixed(2)}x`, meta: L('營收 ÷ 花費', 'Revenue ÷ spend'), color: 'green', delta: '', dir: 'neutral', q: L('ROAS 如何進一步提升？', 'How can I improve ROAS further?') }
      : { label: 'ROAS', value: 'N/A', meta: L('需設定購買轉換追蹤', 'Requires purchase-conversion tracking'), color: '', delta: '', dir: 'neutral', q: L('如何設定購買轉換追蹤以計算 ROAS？', 'How do I set up purchase-conversion tracking to compute ROAS?'), tip: L('真正的 ROAS（營收÷花費）需在 Meta 設定購買事件與金額追蹤才能計算；此活動非購買目標，故無法計算。', 'True ROAS (revenue ÷ spend) requires purchase event + value tracking in Meta; this campaign is not a purchase objective, so it cannot be computed.') },
  }

  // Default order (used when no onboarding goal selected) preserves prior layout.
  // roasReal is intentionally NOT in defaultOrder — it only surfaces for the
  // 「提升轉換與 ROI」(conversion) goal via GOAL_PRIORITY, so non-ROI goals don't
  // get a noisy N/A ROAS card.
  const defaultOrder = ['roas', 'spend', 'cpa', 'ctr', 'cpm', 'reach', 'conversions', 'frequency']
  const lead = optimizationGoal ? GOAL_PRIORITY[optimizationGoal] : []
  const tail = defaultOrder.filter(id => !lead.includes(id))
  const orderedIds = [...lead, ...tail]
  const kpis = orderedIds.map(id => cards[id]).filter(Boolean)

  const hasPurchase = convType === 'purchase'
  const platformCols = platCols(hasPurchase, en)
  const platformRows = PLATFORM_ORDER
    .map(platform => {
      const p = (data.platformBreakdown ?? []).find(x => x.platform === platform)
      const spend = p?.spend ?? 0, clicks = p?.clicks ?? 0, impressions = p?.impressions ?? 0, conversions = p?.conversions ?? 0, revenue = p?.revenue ?? 0
      return {
        label: platformLabel(platform, en), spend, clicks, impressions, conversions, revenue,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        roas: spend > 0 ? (hasPurchase ? revenue / spend : (conversions / spend) * 100) : 0,
        cpp: conversions > 0 ? spend / conversions : 0,
      }
    })
    .filter(r => r.spend > 0 || r.impressions > 0)

  // Device breakdown (impression_device) — same source as the audience tab, shown
  // compactly here. Meta gives no per-device reach, so we compare by impressions /
  // CTR / conversion rate. Sorted by impressions desc; hide devices with no data.
  const deviceRows = (data.deviceBreakdown ?? [])
    .map(d => {
      const clicks = d.clicks ?? 0, dImpr = d.impressions ?? 0, conversions = d.conversions ?? 0
      return {
        label: d.device, impressions: dImpr, clicks, conversions,
        ctr: dImpr > 0 ? (clicks / dImpr) * 100 : 0,
        cvr: clicks > 0 ? (conversions / clicks) * 100 : 0,
      }
    })
    .filter(r => r.impressions > 0 || r.clicks > 0)
    .sort((a, b) => b.impressions - a.impressions)
  type DevCell = { key: string; label: string; kind: 'int' | 'percent' }
  const deviceCols: DevCell[] = [
    { key: 'impressions', label: L('曝光', 'Impr.'), kind: 'int' },
    { key: 'clicks', label: L('點擊', 'Clicks'), kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'conversions', label: L('轉換', 'Conv.'), kind: 'int' },
    { key: 'cvr', label: L('轉換率', 'CVR'), kind: 'percent' },
  ]

  const adPosts = postsSource.filter(p => p.hasAd)
  const avgReach = reachPosts.length > 0 ? Math.round(reachPosts.reduce((s, p) => s + (p.reach ?? 0), 0) / reachPosts.length) : 0
  const topReach = reachPosts.length > 0 ? Math.max(...reachPosts.map(p => p.reach ?? 0)) : 0
  const top3 = [...reachPosts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 3)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chart" size={15} color="var(--ad-blue)" />
          <span style={{ fontSize: 15, fontWeight: 700 }}>{L('整體表現總覽', 'Performance Overview')}</span>
        </div>
        <div className="ads-date-pill"><Icon name="calendar" size={12} />{data.overview.dateRange}</div>
      </div>

      {noAdData && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--ad-blue-light, #eef3fd)', border: '1px solid var(--ad-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: 'var(--ad-text2)', lineHeight: 1.6 }}>
          <span style={{ flexShrink: 0 }}>ℹ️</span>
          <span>{L('此粉專在所選區間沒有可存取的廣告數據，廣告指標（花費／CTR／CPM 等）顯示為 0。「觸及人數」已改為自然貼文觸及；完整自然成效請見下方「內容表現摘要」或左側「內容表現」。', 'No accessible ad data for this page in the selected range, so ad metrics (spend / CTR / CPM, etc.) show 0. "Reach" now shows organic post reach; for full organic performance see "Content Summary" below or "Content" on the left.')}</span>
        </div>
      )}

      <div className="ads-kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className={`ads-kpi-card ${k.color}`} title={k.tip}>
            {onAskAI && <button className="ads-kpi-ask-btn" onClick={() => onAskAI(k.q)}>?</button>}
            <div className="ads-kpi-label">{k.label}{k.tip && <span style={{ marginLeft: 4, color: 'var(--ad-text3)', cursor: 'help' }} title={k.tip}>ⓘ</span>}</div>
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
          <span style={{ fontSize: 13, fontWeight: 600 }}>{L('月度預算進度', 'Monthly budget progress')}</span>
          <span style={{ fontSize: 12, color: 'var(--ad-text3)', fontFamily: 'var(--font-dm-mono)' }}>{fmtK(s.spend)} / {fmtK(data.budget.total)}</span>
        </div>
        <div className="ads-budget-bar-wrap">
          <div className="ads-budget-bar-fill" style={{ width: `${budgetPct}%`, background: budgetPct > 95 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ad-text3)' }}>
          <span>{budgetPct.toFixed(1)}% {L('已使用', 'used')}</span>
          <span>{L('剩餘', 'Remaining')} {fmtK(data.budget.remaining)} · {L('預計月底', 'projected EOM')} {fmtK(data.budget.projectedSpend)}</span>
        </div>
      </div>

      <div className="ads-grid-2">
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{L('每日花費 vs 點擊數', 'Daily spend vs clicks')}</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'clicks', label: L('點擊數', 'Clicks'), color: '#3B6FD4', isInt: true }, { key: 'spend', label: L('花費', 'Spend'), color: '#2E8B57', isCurr: true }]} />
        </div>
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{isVideoBased ? L('每日觀看效益趨勢', 'Daily view-value trend') : isClickBased ? L('每日點擊效益趨勢', 'Daily click-value trend') : L('每日 CPA 趨勢', 'Daily CPA trend')}</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'roas', label: isClickBased ? L('點擊效益', 'Click value') : 'CPA', color: '#3B6FD4' }]} />
        </div>
      </div>

      {platformRows.length > 0 && (
        <div className="ads-card" style={{ overflow: 'hidden', marginTop: 16 }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>{L('平台來源（FB / IG）', 'Platform source (FB / IG)')}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ad-border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--ad-text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{L('平台', 'Platform')}</th>
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

      {deviceRows.length > 0 && (
        <div className="ads-card" style={{ overflow: 'hidden', marginTop: 16 }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>{L('觀看廣告的裝置分佈', 'Ad views by device')}</span>
            <span style={{ fontSize: 11, color: 'var(--ad-text3)', marginLeft: 8 }}>{L('Meta 不提供依裝置的觸及,以曝光 / CTR / 轉換率比較(細分後樣本較小,僅供參考)', 'Meta gives no per-device reach; compared by impressions / CTR / CVR (small samples once split — indicative only)')}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ad-border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--ad-text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{L('裝置', 'Device')}</th>
                  {deviceCols.map(c => (
                    <th key={c.key} style={{ textAlign: 'right', padding: '10px 16px', color: 'var(--ad-text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deviceRows.map((row, ri) => {
                  const vals = row as unknown as Record<string, number>
                  return (
                    <tr key={row.label} style={{ borderBottom: ri < deviceRows.length - 1 ? '1px solid var(--ad-border)' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.label}</td>
                      {deviceCols.map(c => (
                        <td key={c.key} style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{c.kind === 'percent' ? `${(vals[c.key] ?? 0).toFixed(2)}%` : Math.round(vals[c.key] ?? 0).toLocaleString('zh-TW')}</td>
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
          <span style={{ fontSize: 14, fontWeight: 700 }}>{L('內容表現摘要', 'Content Summary')}</span>
          <span style={{ fontSize: 11.5, color: 'var(--ad-text3)' }}>{L(`過去 30 天 · ${postsSource.length} 篇貼文`, `Last 30 days · ${postsSource.length} posts`)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: L('最高觸及', 'Top reach'), value: String(topReach), sub: top3[0] ? `${top3[0].date} ${top3[0].type}` : '—', color: 'var(--ad-blue)' },
            { label: L('平均觸及', 'Avg reach'), value: String(avgReach), sub: L('自然觸及', 'Organic reach'), color: 'var(--ad-blue)' },
            { label: L('平均互動率', 'Avg engagement'), value: reachPosts.length > 0 ? `${(reachPosts.reduce((acc, p) => acc + ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100), 0) / reachPosts.length).toFixed(2)}%` : '—', sub: L('(讚+留言+分享)/觸及', '(likes+comments+shares)/reach'), color: 'var(--ad-green)' },
            { label: L('有廣告加持', 'Boosted'), value: L(`${adPosts.length} 篇`, `${adPosts.length}`), sub: adPosts.length > 0 ? L(`最低 CPA $${Math.min(...adPosts.filter(p => (p.adCpa ?? 0) > 0).map(p => p.adCpa ?? 999)).toFixed(2)}`, `Min CPA $${Math.min(...adPosts.filter(p => (p.adCpa ?? 0) > 0).map(p => p.adCpa ?? 999)).toFixed(2)}`) : L('尚無廣告數據', 'No ad data'), color: 'var(--ad-orange)' },
          ].map(s => (
            <div key={s.label} className="ads-card ads-card-pad" style={{ borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ad-text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-dm-mono)', margin: '4px 0 2px', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div className="ads-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)', fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>{L('🏆 觸及率 Top 3 貼文', '🏆 Top 3 posts by reach')}</div>
          {top3.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--ad-text3)', fontSize: 12.5 }}>{L('暫無觸及資料', 'No reach data yet')}</div>
          ) : top3.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < top3.length - 1 ? '1px solid var(--ad-border)' : 'none' }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'var(--ad-green)' : i === 1 ? 'var(--ad-blue)' : 'var(--ad-surface2)', color: i < 2 ? 'white' : 'var(--ad-text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 1 }}>{p.date} · {p.platform} · {p.type}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ad-blue)', fontFamily: 'var(--font-dm-mono)' }}>{fmt(p.reach ?? 0)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ad-text3)' }}>{L('觸及', 'Reach')}</div>
              </div>
              {p.hasAd && p.adCpa != null && p.adCpa > 0 && <span className="ads-posts-ad-badge">🎯 CPA ${p.adCpa}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
