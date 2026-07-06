'use client'

import { useMemo } from 'react'
import type { DemoBreakdown, FunnelStage, DeviceBreakdown } from '../types'
import { useLang } from '@/lib/i18n/LanguageProvider'

// Funnel stages in canonical order (matches the API's audience-based classification).
const FUNNEL_ORDER = ['Acquisition Prospecting', 'Retargeting', 'Retention']
const funnelLabel = (stage: string, en: boolean): string => en
  ? ({ 'Acquisition Prospecting': 'Prospecting (cold audiences)', 'Retargeting': 'Retargeting (engaged / site audiences)', 'Retention': 'Retention (members / customer lists)' }[stage] ?? stage)
  : ({ 'Acquisition Prospecting': '開發新客 (Prospecting・冷受眾)', 'Retargeting': '再行銷 (Retargeting・互動/網站受眾)', 'Retention': '回購留存 (Retention・會員/顧客名單)' }[stage] ?? stage)

// Friendlier gender labels; Meta returns male / female / unknown.
const genderLabel = (g: string, en: boolean): string => en
  ? ({ male: 'M', female: 'F', unknown: 'Unknown' }[g] ?? g)
  : ({ male: '男', female: '女', unknown: '未知' }[g] ?? g)

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
  cvr: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0, // conversion rate (conv / click)
})

// Device table always surfaces impressions + conversions + CVR regardless of
// whether the page sells — that's the whole point of the device comparison.
function deviceColumns(en: boolean): { key: string; label: string; kind: Kind }[] {
  return [
    { key: 'impressions', label: en ? 'Impressions' : '曝光', kind: 'int' },
    { key: 'clicks', label: en ? 'Clicks' : '點擊', kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'spend', label: en ? 'Spend' : '花費', kind: 'currency' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'conversions', label: en ? 'Conversions' : '轉換', kind: 'int' },
    { key: 'cvr', label: en ? 'CVR' : '轉換率', kind: 'percent' },
  ]
}

// Column set adapts to whether this page sells (purchase) or not.
function columns(hasPurchase: boolean, en: boolean): { key: string; label: string; kind: Kind }[] {
  const base: { key: string; label: string; kind: Kind }[] = [
    { key: 'spend', label: en ? 'Spend' : '花費', kind: 'currency' },
    { key: 'clicks', label: en ? 'Clicks' : '點擊', kind: 'int' },
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'roas', label: 'ROAS', kind: 'ratio' },
  ]
  if (hasPurchase) {
    base.push(
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
      { key: 'conversions', label: en ? 'Conversions' : '轉換', kind: 'int' },
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

export function AudienceSection({ demographics = [], funnelStages = [], deviceBreakdown = [], conversionType }: {
  demographics?: DemoBreakdown[]
  funnelStages?: FunnelStage[]
  deviceBreakdown?: DeviceBreakdown[]
  conversionType?: string
}) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const hasPurchase = conversionType === 'purchase'
  const cols = useMemo(() => columns(hasPurchase, en), [hasPurchase, en])
  const deviceCols = useMemo(() => deviceColumns(en), [en])

  // Age × Gender: single table, one row per (age, gender), sorted by spend desc.
  const demoRows: Row[] = useMemo(() =>
    demographics
      .map(d => ({ label: `${d.age} · ${genderLabel(d.gender, en)}`, spend: d.spend, clicks: d.clicks, impressions: d.impressions, conversions: d.conversions, revenue: d.revenue }))
      .sort((a, b) => b.spend - a.spend)
  , [demographics, en])

  // Funnel: fixed stage order, drop stages with no spend/impressions.
  const funnelRows: Row[] = useMemo(() => {
    const byStage = new Map(funnelStages.map(f => [f.stage, f]))
    return FUNNEL_ORDER
      .map(stage => {
        const f = byStage.get(stage)
        return { label: funnelLabel(stage, en), spend: f?.spend ?? 0, clicks: f?.clicks ?? 0, impressions: f?.impressions ?? 0, conversions: f?.conversions ?? 0, revenue: f?.revenue ?? 0 }
      })
      .filter(r => r.spend > 0 || r.impressions > 0)
  }, [funnelStages, en])

  // Device: one row per device bucket, sorted by impressions desc.
  const deviceRows: Row[] = useMemo(() =>
    deviceBreakdown
      .map(d => ({ label: d.device, spend: d.spend, clicks: d.clicks, impressions: d.impressions, conversions: d.conversions, revenue: d.revenue }))
      .sort((a, b) => b.impressions - a.impressions)
  , [deviceBreakdown])

  const empty = demoRows.length === 0 && funnelRows.length === 0 && deviceRows.length === 0
  if (empty) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9A9490', fontSize: 13 }}>
        {L('此粉專在所選區間內沒有受眾資料。', 'No audience data for this page in the selected range.')}<br />{L('請選擇有投放廣告的日期區間,並按「同步廣告資料」。', 'Pick a date range with ad delivery and click "Sync ad data".')}
      </div>
    )
  }

  return (
    <div className="ads-audience" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Age × Gender */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>{L('人口統計（年齡 × 性別）', 'Demographics (Age × Gender)')}</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>
            {hasPurchase ? L('電商粉專:顯示 Revenue / 轉換 / Cost per Purchase', 'E-commerce page: shows Revenue / Conversions / Cost per Purchase') : L('本粉專廣告層級資料(已隔離,不含同帳號其他粉專)', 'Ad-level data for this page (isolated; excludes other pages on the same account)')}
          </span>
        </div>
        {demoRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>{L('所選區間內沒有人口統計資料。', 'No demographic data in the selected range.')}</div>
          : <MetricTable rows={demoRows} cols={cols} hasPurchase={hasPurchase} firstHeader={L('年齡 · 性別', 'Age · Gender')} />}
      </section>

      {/* Funnel stages */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>{L('漏斗階段', 'Funnel Stages')}</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>{L('依 ad set 自訂受眾類型分類(互動/網站→再行銷,會員名單→留存)', 'Classified by ad set custom-audience type (engagement/site → retargeting, member lists → retention)')}</span>
        </div>
        {funnelRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>{L('所選區間內沒有漏斗階段資料。', 'No funnel data in the selected range.')}</div>
          : <MetricTable rows={funnelRows} cols={cols} hasPurchase={hasPurchase} firstHeader={L('漏斗階段', 'Funnel stage')} />}
      </section>

      {/* Device breakdown */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>{L('各裝置成效', 'Performance by Device')}</h2>
          <span style={{ fontSize: 11.5, color: '#9A9490' }}>{L('Meta 不提供依裝置的觸及,以曝光 / CTR / 轉換率比較(細分後樣本較小,僅供參考)', 'Meta gives no per-device reach; compared by impressions / CTR / CVR (small samples once split — indicative only)')}</span>
        </div>
        {deviceRows.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#9A9490', fontSize: 12.5, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12 }}>{L('所選區間內沒有裝置資料。', 'No device data in the selected range.')}</div>
          : <MetricTable rows={deviceRows} cols={deviceCols} hasPurchase={hasPurchase} firstHeader={L('裝置', 'Device')} />}
      </section>
    </div>
  )
}
