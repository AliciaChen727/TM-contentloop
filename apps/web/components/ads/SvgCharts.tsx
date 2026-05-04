'use client'

import { useState, useRef } from 'react'

interface LineConfig { key: string; label: string; color: string; isCurr?: boolean }
interface DataPoint { [key: string]: number | string }

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)) }

function fmtK(n: number) { return n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}` }

export function SvgChart({ data, lines, height = 160, roasTarget }: {
  data: DataPoint[]
  lines: LineConfig[]
  height?: number
  roasTarget?: number
}) {
  const [tooltip, setTooltip] = useState<{ idx: number; d: DataPoint } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pad = { t: 10, r: 12, b: 28, l: 44 }
  const W = 460, H = height
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  const n = data.length
  const allVals = lines.flatMap(l => data.map(d => d[l.key] as number))
  const minV = Math.min(...allVals) * 0.9, maxV = Math.max(...allVals) * 1.08
  const x = (i: number) => (i / (n - 1)) * cW
  const y = (v: number) => cH - ((v - minV) / (maxV - minV)) * cH
  const makePath = (k: string) => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[k] as number)}`).join(' ')
  const makeArea = (k: string) => `${makePath(k)} L${x(n - 1)},${cH} L0,${cH} Z`

  const handleMM = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = (e.clientX - rect.left - pad.l) * (W / rect.width)
    const idx = clamp(Math.round((mx / cW) * (n - 1)), 0, n - 1)
    setTooltip({ idx, d: data[idx] })
  }

  return (
    <div className="ads-chart-container" style={{ width: '100%', height }}>
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        onMouseMove={handleMM} onMouseLeave={() => setTooltip(null)} style={{ overflow: 'visible', cursor: 'crosshair' }}>
        <defs>
          {lines.map(l => (
            <linearGradient key={l.key} id={`g-${l.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={l.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={l.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${pad.l},${pad.t})`}>
          {[0, 1, 2, 3, 4].map(i => {
            const v = minV + (maxV - minV) * (i / 4), yy = y(v)
            return (
              <g key={i}>
                <line x1={0} y1={yy} x2={cW} y2={yy} stroke="#E2DED8" strokeDasharray="3 3" />
                <text x={-5} y={yy + 4} textAnchor="end" fontSize={9} fill="#9A9490">
                  {v >= 10000 ? `${Math.round(v / 1000)}K` : v.toFixed(1)}
                </text>
              </g>
            )
          })}
          {data.filter((_, i) => i % 5 === 0).map(d => {
            const oi = data.indexOf(d)
            return <text key={oi} x={x(oi)} y={cH + 16} textAnchor="middle" fontSize={9} fill="#9A9490">{d.date as string}</text>
          })}
          {roasTarget && (
            <>
              <line x1={0} y1={y(roasTarget)} x2={cW} y2={y(roasTarget)} stroke="#C96A1A" strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={cW + 3} y={y(roasTarget) + 4} fontSize={9} fill="#C96A1A">目標</text>
            </>
          )}
          {lines.map(l => (
            <g key={l.key}>
              <path d={makeArea(l.key)} fill={`url(#g-${l.key})`} />
              <path d={makePath(l.key)} fill="none" stroke={l.color} strokeWidth={2} />
            </g>
          ))}
          {tooltip && (
            <>
              <line x1={x(tooltip.idx)} y1={0} x2={x(tooltip.idx)} y2={cH} stroke="#3B6FD4" strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
              {lines.map(l => <circle key={l.key} cx={x(tooltip.idx)} cy={y(tooltip.d[l.key] as number)} r={4} fill={l.color} stroke="white" strokeWidth={2} />)}
            </>
          )}
        </g>
      </svg>
      {tooltip && (
        <div className="ads-chart-tooltip" style={{ left: Math.min(x(tooltip.idx) * ((svgRef.current?.getBoundingClientRect().width ?? W) / W) + pad.l + 8, 320), top: 8 }}>
          <div style={{ fontWeight: 600, color: '#9A9490', marginBottom: 3, fontSize: 11 }}>{tooltip.d.date as string}</div>
          {lines.map(l => (
            <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: '#5C5750' }}>{l.label}</span>
              <span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 600, color: l.color }}>
                {l.isCurr ? fmtK(tooltip.d[l.key] as number) : (tooltip.d[l.key] as number).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SvgBarChart({ data, dataKey, labelKey, height = 140, refLine }: {
  data: DataPoint[]
  dataKey: string
  labelKey: string
  height?: number
  refLine?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const maxV = Math.max(...data.map(d => d[dataKey] as number))
  const W = 400, H = height, pad = { t: 8, r: 8, b: 24, l: 32 }
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  const bw = cW / data.length, bGap = bw * 0.3
  const yS = (v: number) => cH - (v / (maxV * 1.12)) * cH

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      <g transform={`translate(${pad.l},${pad.t})`}>
        {[0, 1, 2, 3].map(i => {
          const v = (maxV * 1.12) * (i / 3), yy = yS(v)
          return (
            <g key={i}>
              <line x1={0} y1={yy} x2={cW} y2={yy} stroke="#E2DED8" strokeDasharray="3 3" />
              <text x={-4} y={yy + 4} textAnchor="end" fontSize={9} fill="#9A9490">{v.toFixed(1)}</text>
            </g>
          )
        })}
        {refLine && <line x1={0} y1={yS(refLine)} x2={cW} y2={yS(refLine)} stroke="#C96A1A" strokeDasharray="5 4" strokeWidth={1.5} />}
        {data.map((d, i) => {
          const bx = i * bw + bGap / 2, bh = cH - yS(d[dataKey] as number), by = yS(d[dataKey] as number)
          const isHigh = (d[dataKey] as number) === maxV
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={bx} y={by} width={bw - bGap} height={bh} rx={3} fill={isHigh ? '#3B6FD4' : '#C2D4F5'} opacity={hover === i ? 0.8 : 1} />
              <text x={bx + (bw - bGap) / 2} y={cH + 16} textAnchor="middle" fontSize={9.5} fill="#9A9490">{d[labelKey] as string}</text>
              {hover === i && (
                <text x={bx + (bw - bGap) / 2} y={by - 4} textAnchor="middle" fontSize={9} fill={isHigh ? '#3B6FD4' : '#5C5750'} fontWeight="600">
                  {(d[dataKey] as number).toFixed(1)}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
