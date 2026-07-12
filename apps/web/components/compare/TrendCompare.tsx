'use client'
// 素材成效趨勢比較 (Slice 17): per-page daily spend bars + CTR line, aggregated
// from creativeTrends (last synced ad window). Dependency-free inline SVG.
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface TrendPoint { date: string; spend: number; ctr: number }

function Sparkline({ points }: { points: TrendPoint[] }) {
  const W = 560, H = 96, PAD = 4
  const n = points.length
  const maxSpend = Math.max(1, ...points.map(p => p.spend))
  const maxCtr = Math.max(0.1, ...points.map(p => p.ctr))
  const bw = Math.max(2, (W - PAD * 2) / n - 2)
  const x = (i: number) => PAD + (W - PAD * 2) * (n === 1 ? 0.5 : i / (n - 1))
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(H - PAD - (H - PAD * 2) * (p.ctr / maxCtr)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="trend">
      {points.map((p, i) => (
        <rect key={p.date} x={x(i) - bw / 2} width={bw}
          y={H - PAD - (H - PAD * 2) * (p.spend / maxSpend)}
          height={(H - PAD * 2) * (p.spend / maxSpend)}
          rx={1} className="fill-indigo-100" />
      ))}
      <path d={line} fill="none" strokeWidth={1.6} className="stroke-purple-500" />
    </svg>
  )
}

export function TrendCompare({ pages }: { pages: { pageId: string; pageName: string; trend: TrendPoint[] }[] }) {
  const { L } = useLang()
  const withData = pages
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-gray-900">{L('素材成效趨勢比較', 'Creative Trend Comparison')}</h2>
      <p className="mb-3 mt-0.5 text-xs text-gray-400">{L('每日花費（長條）與 CTR（紫線），彙總自各素材的投放趨勢（最近一次同步的投放期間）', 'Daily spend (bars) and CTR (purple line), aggregated across creatives (last synced ad window)')}</p>
      {withData.length === 0 ? (
        <div className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">{L('尚無趨勢數據（需有廣告投放）', 'No trend data yet (requires ad delivery)')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {withData.map(p => {
            if (p.trend.length < 2) return (
              <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-1 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
                <div className="py-6 text-center text-xs text-gray-400">{L('此區間無投放數據', 'No ad data in this range')}</div>
              </div>
            )
            const totalSpend = p.trend.reduce((s, d) => s + d.spend, 0)
            const peak = p.trend.reduce((a, b) => (b.ctr > a.ctr ? b : a), p.trend[0])
            return (
              <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-gray-900">{p.pageName || p.pageId}</span>
                  <span className="text-xs text-gray-400">{p.trend[0].date} ~ {p.trend[p.trend.length - 1].date}</span>
                </div>
                <div className="mb-1 flex items-center gap-3 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-100 ring-1 ring-indigo-200" />{L('柱狀＝每日花費', 'Bars = daily spend')}</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-purple-500" />{L('折線＝CTR', 'Line = CTR')}</span>
                </div>
                <Sparkline points={p.trend} />
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>{L('總花費', 'Total spend')} ${totalSpend.toLocaleString()}</span>
                  <span>{L('CTR 峰值', 'Peak CTR')} {peak.ctr}%（{peak.date.slice(5)}）</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
