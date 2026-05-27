'use client'

import { useMemo } from 'react'
import type { DemoBreakdown, FunnelStage, PlatformBreakdown } from '../types'

// Funnel stages in canonical order (matches the API's classification).
const FUNNEL_ORDER = ['Acquisition Prospecting', 'Acquisition Re-Engagement', 'Retargeting', 'Retention']
const FUNNEL_LABEL: Record<string, string> = {
  'Acquisition Prospecting': '開發新客 (Prospecting)',
  'Acquisition Re-Engagement': '再互動 (Re-Engagement)',
  'Retargeting': '再行銷 (Retargeting)',
  'Retention': '回購留存 (Retention)',
}

// Friendlier gender labels; Meta returns male / female / unknown.
const GENDER_LABEL: Record<string, string> = { male: '男', female: '女', unknown: '未知' }

// Platform source order + labels (only FB / IG surfaced).
const PLATFORM_ORDER = ['facebook', 'instagram']
const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram' }

type Kind = 'currency' | 'int' | 'percent' | 'ratio'
const fmt = (v: number, kind: Kind) =>
  kind === 'currency' ? `$${Math.round(v).toLocaleString('zh-TW')}`
  : kind === 'percent' ? `${v.toFixed(2)}%`
  : kind === 'ratio' ? v.toFixed(2)
  : Math.round(v).toLocaleString('zh-TW')

// Row of derived metrics shared by both tables.
interface Row {
  label: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
  revenue: number
}
const derive = (r: Row, hasPurchase: boolean) => ({
  ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
  cpc: r.clicks > 0 ? r.spend / r.clicks : 0,
  // ROAS: revenue/spend for e-commerce; click-efficiency (conv per $) otherwise.
  roas: r.spend > 0 ? (hasPurchase ? r.revenue / r.spend : (r.conversions / r.spend) * 100) : 0,
  cpp: r.conversions > 0 ? r.spend / r.conversions : 0, // cost per purchase/conversion
})

// Column set adapts to whether this page sells (purchase) or not.
function columns(hasPurchase: boolean): { key: string; label: string; kind: Kind }[] {
  const base: { key: string; label: string; kind: Kind }[] = [
    { key: 'spend', label: '花費', kind: 'currency' },
    { key: 'clicks', label: '點擊', kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'roas', label: 'ROAS', kind: 'ratio' },
  ]
  if (hasPurchase) {
    base.push(
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
      { key: 'conversions', label: '轉換', kind: 'int' },
      { key: 'cpp', label: 'Cost / Purchase', kind: 'currency' },
    )
  }
  return base
}

function MetricTable({ rows, cols, hasPurchase, firstHeader }: {
  rows: Row[]
  cols: { key: string; label: string; kind: Kind }[]
  hasPurchase: boolean
  firstHeader: string
}) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2DED8' }}>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#5C5750', fontWeight: 600, whiteSpace: 'nowrap' }}>{firstHeader}</th>
              {cols.map(c => (
                <th key={c.key} style={{ textAlign: 'right', padding: '12px 16px', color: '#5C5750', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const d = derive(row, hasPurchase)
              const vals: Record<string, number> = { spend: row.spend, clicks: row.clicks, impressions: row.impressions, conversions: row.conversions, revenue: row.revenue, ...d }
              return (
                <tr key={row.label} style={{ borderBottom: ri < rows.length - 1 ? '1px solid #F0EDE8' : 'none', background: ri % 2 ? '#FAF8F5' : 'white' }}>
                  <td style={{ padding: '10px 16px', color: '#2A2722', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.label}</td>
                  {cols.map(c => (
                    <td key={c.key} style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)', color: '#2A2722' }}>
                      {fmt(vals[c.key] ?? 0, c.kind)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AudienceSection({ demographics = [], platformBreakdown = [], funnelStages = [], conversionType }: {
  demographics?: DemoBreakdown[]
  platformBreakdown?: PlatformBreakdown[]
  funnelStages?: FunnelStage[]
  conversionType?: string
}) {
  const hasPurchase = conversionType === 'purchase'
  const cols = useMemo(() => columns(hasPurchase), [hasPurchase])

  // Age × Gender: single table, one row per (age, gender), sorted by spend desc.
  const demoRows: Row[] = useMemo(() =>
    demographics
      .map(d => ({ label: `${d.age} · ${GENDER_LABEL[d.gender] ?? d.gender}`, spend: d.spend, clicks: d.clicks, impressions: d.impressions, conversions: d.conversions, revenue: d.revenue }))
      .sort((a, b) => b.spend - a.spend)
  , [demographics])

  // Platform source: fixed FB → IG order, drop platforms with no spend/impressions.
  const platformRows: Row[] = useMemo(() => {
    const byPlatform = new Map(platformBreakdown.map(p => [p.platform, p]))
    return PLATFORM_ORDER
      .map(platform => {
        const p = byPlatform.get(platform)
        return { label: PLATFORM_LABEL[platform] ?? platform, spend: p?.spend ?? 0, clicks: p?.clicks ?? 0, impressions: p?.impressions ?? 0, conversions: p?.conversions ?? 0, revenue: p?.revenue ?? 0 }
      })
      .filter(r => r.spend > 0 || r.impressions > 0)
  }, [platformBreakdown])

  // Funnel: fixed stage order, drop stages with no spend/impressions.
  const funnelRows: Row[] = useMemo(() => {
    const byStage = new Map(funnelStages.map(f => [f.stage, f]))
    return FUNNEL_ORDER
      .map(stage => {
        const f = byStage.get(stage)
        return { label: FUNNEL_LABEL[stage] ?? stage, spend: f?.spend ?? 0, clicks: f?.clicks ?? 0, impressions: f?.impressions ?? 0, conversions: f?.conversions ?? 0, revenue: f?.revenue ?? 0 }
      })
      .filter(r => r.spend > 0 || r.impressions > 0)
  }, [funnelStages])

  const empty = demoRows.length === 0 && platformRows.length === 0 && funnelRows.length === 0
  if (empty) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9A9490', fontSize: 13 }}>
        此粉專在所選區間內沒有受眾資料。<br />請選擇有投放廣告的日期區間,並按「同步廣告資料」。
      </div>
    )
  }

  return (
    <div className="ads-audience" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Age × Gender */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>人口統計（年齡 × 性別）</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>
            {hasPurchase ? '電商粉專:顯示 Revenue / 轉換 / Cost per Purchase' : '本粉專廣告層級資料(已隔離,不含同帳號其他粉專)'}
          </span>
        </div>
        {demoRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>所選區間內沒有人口統計資料。</div>
          : <MetricTable rows={demoRows} cols={cols} hasPurchase={hasPurchase} firstHeader="年齡 · 性別" />}
      </section>

      {/* Platform source: FB vs IG */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>平台來源（FB / IG）</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>依 publisher_platform 拆分(Meta 限制:無法與年齡×性別交叉同表)</span>
        </div>
        {platformRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>所選區間內沒有平台來源資料。</div>
          : <MetricTable rows={platformRows} cols={cols} hasPurchase={hasPurchase} firstHeader="平台" />}
      </section>

      {/* Funnel stages */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>漏斗階段</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>依 campaign objective 近似分類</span>
        </div>
        {funnelRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>所選區間內沒有漏斗階段資料。</div>
          : <MetricTable rows={funnelRows} cols={cols} hasPurchase={hasPurchase} firstHeader="漏斗階段" />}
      </section>
    </div>
  )
}
