'use client'

import { useState, useMemo } from 'react'
import type { CreativeTrend, CreativeTrendDaily, Experiment, LabelEntry, Variant } from '../types'
import { SvgChart } from '../SvgCharts'

// Color palette for per-creative lines (reused for legend dots).
const COLORS = ['#3B6FD4', '#C96A1A', '#2E9E6B', '#B5179E', '#E0A800', '#7048E8', '#E5484D', '#0CA5B0']

type MetricKey = 'spend' | 'reach' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'roas'
interface MetricDef { label: string; kind: 'currency' | 'int' | 'percent' | 'ratio'; perDay: (d: CreativeTrendDaily) => number }

const METRICS: Record<MetricKey, MetricDef> = {
  spend: { label: '花費', kind: 'currency', perDay: d => d.spend },
  reach: { label: '觸及', kind: 'int', perDay: d => d.reach },
  impressions: { label: '曝光', kind: 'int', perDay: d => d.impressions },
  clicks: { label: '點擊', kind: 'int', perDay: d => d.clicks },
  ctr: { label: 'CTR', kind: 'percent', perDay: d => d.ctr },
  cpc: { label: 'CPC', kind: 'currency', perDay: d => (d.clicks > 0 ? d.spend / d.clicks : 0) },
  cpm: { label: 'CPM', kind: 'currency', perDay: d => (d.impressions > 0 ? d.spend / d.impressions * 1000 : 0) },
  roas: { label: '點擊效益', kind: 'ratio', perDay: d => d.roas },
}
const METRIC_ORDER: MetricKey[] = ['spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'roas']

const fmtVal = (v: number, kind: MetricDef['kind']) =>
  kind === 'currency' ? `$${Math.round(v).toLocaleString('zh-TW')}`
  : kind === 'percent' ? `${v.toFixed(2)}%`
  : kind === 'ratio' ? v.toFixed(2)
  : Math.round(v).toLocaleString('zh-TW')

// Inclusive day list between two YYYY-MM-DD dates.
function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00')
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
  return out
}

// Split [from, to] into 7-day buckets labelled Week 1, 2, …
function weekBuckets(from: string, to: string): { label: string; start: string; end: string }[] {
  const days = dayRange(from, to)
  const buckets: { label: string; start: string; end: string }[] = []
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7)
    buckets.push({ label: `Week ${buckets.length + 1}`, start: chunk[0], end: chunk[chunk.length - 1] })
  }
  return buckets
}

export function CreativeTrendsSection({ trends, dateFrom, dateTo, conversionType, experiments = [], creativeLabels = {} }: {
  trends: CreativeTrend[]
  dateFrom: string
  dateTo: string
  conversionType?: string
  experiments?: Experiment[]
  creativeLabels?: Record<string, LabelEntry>
}) {
  const hasPurchase = conversionType === 'purchase'
  const [metric, setMetric] = useState<MetricKey>('spend')
  const [expId, setExpId] = useState<string>('')
  // Default-select up to the top 3 creatives (already sorted by spend in the API).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(trends.slice(0, 3).map(t => t.adId)))

  const inRange = (date: string) => date >= dateFrom && date <= dateTo

  // Per-creative daily map (date -> daily) limited to the selected date range.
  const trendMap = useMemo(() => {
    const m = new Map<string, Map<string, CreativeTrendDaily>>()
    for (const t of trends) {
      const dm = new Map<string, CreativeTrendDaily>()
      for (const d of t.daily) if (inRange(d.date)) dm.set(d.date, d)
      m.set(t.adId, dm)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trends, dateFrom, dateTo])

  const def = METRICS[metric]
  const colorOf = (adId: string) => COLORS[trends.findIndex(t => t.adId === adId) % COLORS.length]

  // Chart: one line per selected creative, value = chosen metric for that day.
  const selectedTrends = trends.filter(t => selected.has(t.adId))
  const chartData = useMemo(() => {
    const dates = dayRange(dateFrom, dateTo)
    return dates.map(date => {
      const row: Record<string, number | string> = { date: date.slice(5) } // MM-DD
      for (const t of selectedTrends) {
        const d = trendMap.get(t.adId)?.get(date)
        row[t.adId] = d ? def.perDay(d) : 0
      }
      return row
    })
  }, [selectedTrends, trendMap, def, dateFrom, dateTo])

  const lines = selectedTrends.map(t => ({
    key: t.adId,
    label: t.name,
    color: colorOf(t.adId),
    isCurr: def.kind === 'currency',
    isInt: def.kind === 'int',
  }))

  // Weekly table: aggregate selected creatives within each 7-day bucket.
  const weeks = useMemo(() => weekBuckets(dateFrom, dateTo), [dateFrom, dateTo])
  const weeklyAgg = useMemo(() => weeks.map(w => {
    let spend = 0, reach = 0, impressions = 0, clicks = 0, conv = 0, rev = 0
    for (const t of selectedTrends) {
      for (const d of Array.from(trendMap.get(t.adId)?.values() ?? [])) {
        if (d.date >= w.start && d.date <= w.end) {
          spend += d.spend; reach += d.reach; impressions += d.impressions; clicks += d.clicks
          conv += d.conversions; rev += d.revenue
        }
      }
    }
    return {
      spend, reach, impressions, clicks,
      ctr: impressions > 0 ? clicks / impressions * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? spend / impressions * 1000 : 0,
      // ROAS from aggregated values (revenue/spend for purchase, else click-efficiency)
      roas: spend > 0 && conv > 0 ? (hasPurchase ? rev / spend : conv / spend * 100) : 0,
      conversions: 0, revenue: 0, // reserved — populated once GA is connected
    }
  }), [weeks, selectedTrends, trendMap, hasPurchase])

  // ── A/B testing ─────────────────────────────────────────────────────────
  const trendAdIds = useMemo(() => new Set(trends.map(t => t.adId)), [trends])
  const labeledExperiments = useMemo(() => {
    const withData = new Set<string>()
    for (const [adId, entry] of Object.entries(creativeLabels)) {
      if (entry.experimentId && trendAdIds.has(adId)) withData.add(entry.experimentId)
    }
    return experiments.filter(e => withData.has(e.id))
  }, [experiments, creativeLabels, trendAdIds])

  const aggregateRange = (adIds: string[]) => {
    let spend = 0, reach = 0, impressions = 0, clicks = 0, conv = 0, rev = 0
    for (const id of adIds) for (const d of Array.from(trendMap.get(id)?.values() ?? [])) {
      spend += d.spend; reach += d.reach; impressions += d.impressions; clicks += d.clicks; conv += d.conversions; rev += d.revenue
    }
    return {
      spend, reach, impressions, clicks,
      ctr: impressions > 0 ? clicks / impressions * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? spend / impressions * 1000 : 0,
      roas: spend > 0 && conv > 0 ? (hasPurchase ? rev / spend : conv / spend * 100) : 0,
    }
  }

  const VARIANTS: Variant[] = ['A', 'B', 'control']
  const VARIANT_LABEL: Record<Variant, string> = { A: 'A', B: 'B', control: '控制組' }
  const abData = useMemo(() => {
    if (!expId) return null
    const groups: Record<Variant, string[]> = { A: [], B: [], control: [] }
    for (const [adId, entry] of Object.entries(creativeLabels)) {
      if (entry.experimentId === expId && trendAdIds.has(adId)) groups[entry.variant].push(adId)
    }
    return VARIANTS.filter(v => groups[v].length > 0).map(v => ({ variant: v, adIds: groups[v], agg: aggregateRange(groups[v]) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expId, creativeLabels, trendAdIds, trendMap, hasPurchase])

  const selectedExp = labeledExperiments.find(e => e.id === expId)

  const toggle = (adId: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(adId)) n.delete(adId); else n.add(adId)
    return n
  })

  if (trends.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9A9490', fontSize: 13 }}>
        此粉專在所選區間內沒有廣告素材資料。<br />請選擇有投放廣告的日期區間，並按「同步廣告資料」。
      </div>
    )
  }

  const ROWS: { key: MetricKey | 'conversions' | 'revenue' | 'roasReal'; label: string; kind: MetricDef['kind']; reserved?: boolean; naDash?: boolean; note?: string }[] = [
    { key: 'ctr', label: 'CTR', kind: 'percent' },
    { key: 'roas', label: '點擊效益', kind: 'ratio' },
    { key: 'roasReal', label: 'ROAS', kind: 'ratio', reserved: true, naDash: true, note: '需購買追蹤' },
    { key: 'clicks', label: '點擊數', kind: 'int' },
    { key: 'impressions', label: '曝光', kind: 'int' },
    { key: 'reach', label: '觸及', kind: 'int' },
    { key: 'cpc', label: 'CPC', kind: 'currency' },
    { key: 'cpm', label: 'CPM', kind: 'currency' },
    { key: 'spend', label: '花費', kind: 'currency' },
    { key: 'conversions', label: '轉換', kind: 'int', reserved: true },
    { key: 'revenue', label: 'Revenue', kind: 'currency', reserved: true },
  ]

  return (
    <div className="ads-trends">
      {/* Header: title + metric selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ad-text, #2A2722)' }}>素材成效趨勢</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {labeledExperiments.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#5C5750' }}>
              A/B 實驗
              <select value={expId} onChange={e => setExpId(e.target.value)}
                style={{ padding: '6px 10px', fontSize: 13, border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 8, background: 'white', cursor: 'pointer', maxWidth: 200 }}>
                <option value="">— 不比較 —</option>
                {labeledExperiments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#5C5750' }}>
            指標
            <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 8, background: 'white', cursor: 'pointer' }}>
              {METRIC_ORDER.map(k => <option key={k} value={k}>{METRICS[k].label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* A/B testing comparison panel */}
      {abData && selectedExp && (
        <div style={{ marginBottom: 20, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#2A2722' }}>
              A/B 實驗比較：{selectedExp.name}
              {selectedExp.winner && selectedExp.winner !== 'pending' && (
                <span style={{ marginLeft: 10, fontSize: 11.5, color: '#2E9E6B', background: '#E7F5EE', padding: '2px 8px', borderRadius: 999 }}>勝出：{selectedExp.winner}</span>
              )}
            </div>
            <button onClick={() => setSelected(new Set(abData.flatMap(g => g.adIds)))}
              style={{ background: 'none', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 8, padding: '5px 10px', fontSize: 12, color: '#3B6FD4', cursor: 'pointer' }}>
              在圖表中比較這些素材
            </button>
          </div>
          {abData.length === 0
            ? <div style={{ color: '#9A9490', fontSize: 12.5 }}>此實驗在所選區間內沒有素材資料。</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2DED8', color: '#9A9490', fontSize: 11.5 }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px' }}>Variant</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>素材數</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>花費</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>點擊</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>CTR</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>CPC</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>點擊效益</th>
                  </tr>
                </thead>
                <tbody>
                  {abData.map(g => {
                    const isWinner = selectedExp.winner === g.variant
                    return (
                      <tr key={g.variant} style={{ borderBottom: '1px solid #F0EDE8', background: isWinner ? '#E7F5EE' : 'transparent' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{VARIANT_LABEL[g.variant]}{isWinner && ' 🏆'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#9A9490' }}>{g.adIds.length}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtVal(g.agg.spend, 'currency')}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtVal(g.agg.clicks, 'int')}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtVal(g.agg.ctr, 'percent')}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtVal(g.agg.cpc, 'currency')}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-dm-mono)' }}>{fmtVal(g.agg.roas, 'ratio')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
        </div>
      )}

      {/* Chart + legend */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 320, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12.5, color: '#9A9490', marginBottom: 8 }}>{def.label}（每日，依所選素材）</div>
          {selectedTrends.length === 0
            ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9A9490', fontSize: 12 }}>請從右側勾選至少一個素材</div>
            : <SvgChart data={chartData} lines={lines} height={220} yFmt={v => fmtVal(v, def.kind)} />}
        </div>

        {/* Creative legend with thumbnails — scrollable so many creatives stay usable */}
        <div style={{ flex: '0 0 250px', minWidth: 230, border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #F0EDE8', fontSize: 11.5 }}>
            <span style={{ color: '#5C5750' }}>素材（{selected.size}/{trends.length}）</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSelected(new Set(trends.map(t => t.adId)))}
                style={{ background: 'none', border: 'none', color: '#3B6FD4', cursor: 'pointer', fontSize: 11.5 }}>全選</button>
              <button onClick={() => setSelected(new Set())}
                style={{ background: 'none', border: 'none', color: '#9A9490', cursor: 'pointer', fontSize: 11.5 }}>清除</button>
            </span>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {trends.map(t => {
              const on = selected.has(t.adId)
              return (
                <button key={t.adId} onClick={() => toggle(t.adId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid #F0EDE8', cursor: 'pointer', textAlign: 'left', opacity: on ? 1 : 0.5 }}>
                  <input type="checkbox" checked={on} readOnly style={{ accentColor: colorOf(t.adId), cursor: 'pointer' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: colorOf(t.adId), flexShrink: 0 }} />
                  {t.thumbnailUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={t.thumbnailUrl} alt="" width={34} height={34} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 34, height: 34, borderRadius: 6, background: '#F0EDE8', flexShrink: 0 }} />}
                  <span style={{ fontSize: 12, color: '#2A2722', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Weekly key-metrics table */}
      <div style={{ marginTop: 24, background: 'white', border: '1px solid var(--ad-border, #E2DED8)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2DED8' }}>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#5C5750', fontWeight: 600 }}>每週指標</th>
              {weeks.map(w => (
                <th key={w.label} style={{ textAlign: 'center', padding: '12px 16px', color: '#2A2722', fontWeight: 700 }}>
                  {w.label}<div style={{ fontSize: 10, color: '#9A9490', fontWeight: 400 }}>{w.start.slice(5)}~{w.end.slice(5)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, ri) => (
              <tr key={r.key} style={{ borderBottom: ri < ROWS.length - 1 ? '1px solid #F0EDE8' : 'none', background: ri % 2 ? '#FAF8F5' : 'white' }}>
                <td style={{ padding: '10px 16px', color: r.reserved ? '#B8B2AA' : '#5C5750' }}>
                  {r.label}{r.reserved && <span style={{ fontSize: 10, marginLeft: 4 }}>({r.note ?? '待接 GA'})</span>}
                </td>
                {weeks.map((w, wi) => (
                  <td key={w.label} style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-dm-mono)', color: r.reserved ? '#B8B2AA' : '#2A2722' }}>
                    {r.naDash ? '—' : fmtVal((weeklyAgg[wi] as Record<string, number>)[r.key] ?? 0, r.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
