'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Icon } from '../Icon'
import type { AdData } from '../types'

const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`
const STATUS_LABEL: Record<string, string> = { top: '🏆 最佳', good: '👍 良好', ok: '一般', bad: '⚠️ 待優' }
const TYPES = ['全部', 'Reels', '貼文', 'Stories', '海報']
type SortBy = 'roas' | 'spend' | 'cpa'
type Variant = 'A' | 'B' | 'control'
type WinnerType = 'pending' | 'A' | 'B' | 'inconclusive'

const WINNER_OPTIONS: { value: WinnerType; label: string }[] = [
  { value: 'pending', label: '尚未得出結論' },
  { value: 'A', label: 'A 組勝出' },
  { value: 'B', label: 'B 組勝出' },
  { value: 'inconclusive', label: '無顯著差異' },
]

const STATUS_LABEL_TEXT: Record<string, string> = { top: '最佳', good: '良好', ok: '一般', bad: '待優' }

const VARIANT_STYLE: Record<Variant, { bg: string; color: string; label: string }> = {
  control: { bg: '#f1f5f9', color: '#475569', label: '控制組' },
  A: { bg: '#dbeafe', color: '#1d4ed8', label: 'A 版' },
  B: { bg: '#ffedd5', color: '#c2410c', label: 'B 版' },
}

function buildCreativePrompt(c: AdData['creatives'][number]): string {
  return `請分析這個廣告素材：\n《${c.name}》\n類型：${c.type}｜頻道：${c.channel}｜狀態：${STATUS_LABEL_TEXT[c.status] ?? c.status}\nCPA：$${c.cpa.toFixed(2)}｜點擊效益：${c.roas.toFixed(1)}x｜花費：$${c.spend}｜CTR：${Number(c.ctr).toFixed(2)}%｜曝光：${c.impressions.toLocaleString()}\n\n請給出這個素材的成效診斷和具體優化建議。`
}

const PlatformIcon = ({ type }: { type: 'IG' | 'FB' }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 5px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    marginRight: 6,
    verticalAlign: 'text-bottom',
    ...(type === 'IG'
      ? { background: '#fce4ec', color: '#c2185b' }
      : { background: '#e3f2fd', color: '#1976d2' })
  }}>
    {type}
  </span>
)

function renderAdName(name: string) {
  let isIg = false
  let cleanName = name

  if (/^Instagram (post|貼文)[:：\s]*/i.test(name)) {
    isIg = true
    cleanName = name.replace(/^Instagram (post|貼文)[:：\s]*/i, '')
  } else if (/Instagram/i.test(name)) {
    isIg = true
  }

  return (
    <>
      <PlatformIcon type={isIg ? 'IG' : 'FB'} />
      {cleanName}
    </>
  )
}

function VariantBadge({ adId, variant, onLabelChange }: {
  adId: string
  variant: Variant | undefined
  onLabelChange: (adId: string, variant: Variant | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const options: { value: Variant | null; label: string }[] = [
    { value: 'A', label: 'A 版（AI 建議）' },
    { value: 'B', label: 'B 版（測試）' },
    { value: 'control', label: '控制組（原版）' },
    { value: null, label: '清除標籤' },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="設定 A/B 測試標籤"
        style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: 'none',
          ...(variant ? { background: VARIANT_STYLE[variant].bg, color: VARIANT_STYLE[variant].color } : { background: '#f1f5f9', color: '#94a3b8' }),
          fontFamily: 'inherit',
        }}
      >
        {variant ? VARIANT_STYLE[variant].label : '＋ 標記'}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 140, overflow: 'hidden' }}>
          {options.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => { onLabelChange(adId, opt.value); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12,
                background: 'none', border: 'none', cursor: 'pointer', color: opt.value === null ? '#ef4444' : '#1e293b',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function pct(val: number, base: number): string {
  if (base === 0) return '—'
  const d = ((val - base) / base) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(0)}%`
}

function pctColor(val: number, base: number, higherIsBetter: boolean): string {
  if (base === 0) return '#64748b'
  const improved = higherIsBetter ? val > base : val < base
  return improved ? '#16a34a' : '#dc2626'
}

interface GroupStats { ctr: number; cpa: number; roas: number; totalSpend: number; count: number }

function calcGroupStats(creatives: AdData['creatives']): GroupStats {
  if (creatives.length === 0) return { ctr: 0, cpa: 0, roas: 0, totalSpend: 0, count: 0 }
  let totalSpend = 0, wCtr = 0, wCpa = 0, wRoas = 0
  for (const c of creatives) {
    totalSpend += c.spend
    wCtr += Number(c.ctr) * c.spend
    wCpa += c.cpa * c.spend
    wRoas += c.roas * c.spend
  }
  const s = totalSpend || 1
  return { ctr: wCtr / s, cpa: wCpa / s, roas: wRoas / s, totalSpend, count: creatives.length }
}

type AbTestUpdate = { aiDiagnosis?: string; winner?: string; ctrDelta?: number; cpaDelta?: number; controlCopy?: string; variantCopy?: string }

function AbTestPanel({ allCreatives, labels, abTestData, onAbTestUpdate }: {
  allCreatives: AdData['creatives']
  labels: Record<string, Variant>
  abTestData: { aiDiagnosis: string; winner: string }
  onAbTestUpdate: (update: AbTestUpdate) => void
}) {
  const [localDiagnosis, setLocalDiagnosis] = useState(abTestData.aiDiagnosis)

  useEffect(() => { setLocalDiagnosis(abTestData.aiDiagnosis) }, [abTestData.aiDiagnosis])

  const groups: Record<Variant, AdData['creatives']> = { control: [], A: [], B: [] }
  for (const c of allCreatives) {
    const v = labels[c.id]
    if (v) groups[v].push(c)
  }
  const controlStats = groups.control.length > 0 ? calcGroupStats(groups.control) : null
  const aStats = groups.A.length > 0 ? calcGroupStats(groups.A) : null
  const bStats = groups.B.length > 0 ? calcGroupStats(groups.B) : null

  const baseStats = controlStats ?? aStats
  const variantStats = controlStats ? (aStats ?? bStats) : bStats

  const winner = abTestData.winner as WinnerType
  const winnerStats = winner === 'A' ? aStats : winner === 'B' ? bStats : null

  const totalLinkClicks = (arr: AdData['creatives']) =>
    arr.reduce((sum, c) => sum + (c.linkClicks ?? 0), 0)

  const baseGroup = groups.control.length > 0 ? groups.control : groups.A
  const variantGroup = controlStats ? (groups.A.length > 0 ? groups.A : groups.B) : groups.B
  const baseLinkClicks = totalLinkClicks(baseGroup)
  const variantLinkClicks = variantStats ? totalLinkClicks(variantGroup) : 0
  const baseCpc = baseLinkClicks > 0 && baseStats ? parseFloat((baseStats.totalSpend / baseLinkClicks).toFixed(2)) : 0
  const variantCpc = variantLinkClicks > 0 && variantStats ? parseFloat((variantStats.totalSpend / variantLinkClicks).toFixed(2)) : 0

  const winnerGroup = winner === 'A' ? groups.A : winner === 'B' ? groups.B : []
  const winnerLinkClicks = totalLinkClicks(winnerGroup)
  const winnerCpc = winnerLinkClicks > 0 && winnerStats ? parseFloat((winnerStats.totalSpend / winnerLinkClicks).toFixed(2)) : 0

  const tableRows = [
    { label: 'CTR', ctrl: baseStats ? `${baseStats.ctr.toFixed(2)}%` : '—', variant: variantStats ? `${variantStats.ctr.toFixed(2)}%` : '—' },
    { label: 'CPC', ctrl: baseCpc > 0 ? `$${baseCpc.toFixed(2)}` : '—', variant: variantCpc > 0 ? `$${variantCpc.toFixed(2)}` : '—' },
    { label: '花費', ctrl: baseStats ? fmtK(baseStats.totalSpend) : '—', variant: variantStats ? fmtK(variantStats.totalSpend) : '—' },
    { label: '連結點擊數', ctrl: baseLinkClicks > 0 ? baseLinkClicks.toLocaleString() : '—', variant: variantLinkClicks > 0 ? variantLinkClicks.toLocaleString() : '—' },
  ]

  const ctrDelta = winnerStats && baseStats && baseStats.ctr > 0
    ? (winnerStats.ctr - baseStats.ctr) / baseStats.ctr * 100 : null
  const cpaDelta = baseCpc > 0 && winnerCpc > 0
    ? (baseCpc - winnerCpc) / baseCpc * 100 : null

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 8px', border: '1px solid #bfdbfe', borderRadius: 6,
    background: 'white', color: '#1e293b', fontFamily: 'var(--font-dm-sans)', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ marginTop: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 4, fontWeight: 500, color: '#64748b' }}>指標</th>
            <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 500, color: '#64748b' }}>控制組</th>
            <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 500, color: '#1d4ed8' }}>AI 建議版</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map(r => (
            <tr key={r.label} style={{ borderTop: '1px solid #dbeafe' }}>
              <td style={{ padding: '4px 0', color: '#64748b' }}>{r.label}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--font-dm-mono)', fontWeight: 500 }}>{r.ctrl}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--font-dm-mono)', fontWeight: 500, color: '#1d4ed8' }}>{r.variant}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>實驗結果</label>
        <select value={winner} onChange={e => {
          const newWinner = e.target.value
          const update: AbTestUpdate = { winner: newWinner }
          if (newWinner === 'A' || newWinner === 'B') {
            const winStats = newWinner === 'A' ? aStats : bStats
            const wClicks = totalLinkClicks(newWinner === 'A' ? groups.A : groups.B)
            const wCpc = wClicks > 0 && winStats ? winStats.totalSpend / wClicks : 0
            if (winStats && baseStats && baseStats.ctr > 0) update.ctrDelta = parseFloat(((winStats.ctr - baseStats.ctr) / baseStats.ctr * 100).toFixed(1))
            if (baseCpc > 0 && wCpc > 0) update.cpaDelta = parseFloat(((baseCpc - wCpc) / baseCpc * 100).toFixed(1))
            update.controlCopy = groups.control[0]?.name ?? groups.A[0]?.name ?? ''
            update.variantCopy = (newWinner === 'A' ? groups.A[0] : groups.B[0])?.name ?? ''
          }
          onAbTestUpdate(update)
        }} style={{ ...inputStyle, cursor: 'pointer' }}>
          {WINNER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {winnerStats && baseStats && (ctrDelta !== null || cpaDelta !== null) && (
        <p style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, margin: '0 0 8px' }}>
          AI 建議版
          {ctrDelta !== null && ` CTR ${ctrDelta > 0 ? '+' : ''}${ctrDelta.toFixed(0)}%`}
          {ctrDelta !== null && cpaDelta !== null && '，'}
          {cpaDelta !== null && ` CPC ${cpaDelta > 0 ? '降低' : '上升'} ${cpaDelta > 0 ? '-' : '+'}${Math.abs(cpaDelta).toFixed(0)}%`}
        </p>
      )}

      <div>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>AI 當初的診斷說了什麼</label>
        <textarea
          value={localDiagnosis}
          onChange={e => setLocalDiagnosis(e.target.value)}
          onBlur={() => { if (localDiagnosis !== abTestData.aiDiagnosis) onAbTestUpdate({ aiDiagnosis: localDiagnosis }) }}
          placeholder="貼上 AI Sidekick 給出的建議內容..."
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    </div>
  )
}

function ExperimentResultCard({ creatives, labels }: {
  creatives: AdData['creatives']
  labels: Record<string, Variant>
}) {
  const groups: Record<Variant, AdData['creatives']> = { control: [], A: [], B: [] }
  for (const c of creatives) {
    const v = labels[c.id]
    if (v) groups[v].push(c)
  }

  const hasControl = groups.control.length > 0
  const hasA = groups.A.length > 0
  const hasB = groups.B.length > 0
  if (!((hasControl && (hasA || hasB)) || (hasA && hasB))) return null

  const controlStats = hasControl ? calcGroupStats(groups.control) : null
  const aStats = hasA ? calcGroupStats(groups.A) : null
  const bStats = hasB ? calcGroupStats(groups.B) : null
  const baseStats = controlStats ?? aStats!

  const bestGroup = (() => {
    if (aStats && bStats) return aStats.ctr > bStats.ctr ? 'A' : 'B'
    if (aStats) return 'A'
    return null
  })()

  const rows: { stats: GroupStats; variant: Variant }[] = []
  if (controlStats) rows.push({ stats: controlStats, variant: 'control' })
  if (aStats) rows.push({ stats: aStats, variant: 'A' })
  if (bStats) rows.push({ stats: bStats, variant: 'B' })

  return (
    <div style={{ marginBottom: 16, borderRadius: 12, border: '1.5px solid #bfdbfe', background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>🧪</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>A/B 實驗結果</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ stats, variant }) => {
          const isBase = variant === 'control' || (!hasControl && variant === 'A')
          const style = VARIANT_STYLE[variant]
          return (
            <div key={variant} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.7)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: style.bg, color: style.color, whiteSpace: 'nowrap', minWidth: 52, textAlign: 'center' }}>{style.label}</span>
              <div style={{ flex: 1, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                <div>
                  <span style={{ color: '#64748b' }}>CTR </span>
                  <span style={{ fontWeight: 600 }}>{stats.ctr.toFixed(2)}%</span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.ctr, baseStats.ctr, true) }}>{pct(stats.ctr, baseStats.ctr)}</span>}
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>CPA </span>
                  <span style={{ fontWeight: 600 }}>${stats.cpa.toFixed(0)}</span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.cpa, baseStats.cpa, false) }}>{pct(stats.cpa, baseStats.cpa)}</span>}
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>ROAS </span>
                  <span style={{ fontWeight: 600 }}>{stats.roas.toFixed(1)}x</span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.roas, baseStats.roas, true) }}>{pct(stats.roas, baseStats.roas)}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {bestGroup && aStats && (
        <p style={{ marginTop: 10, fontSize: 11.5, color: '#1e40af', fontWeight: 500 }}>
          📌 AI Sidekick 建議版（A 版）{hasControl
            ? `CTR ${pct(aStats.ctr, baseStats.ctr)} ，CPA ${pct(aStats.cpa, baseStats.cpa)}`
            : `CTR ${aStats.ctr.toFixed(2)}%`}
          {bestGroup === 'A' ? '，目前領先' : ''}
        </p>
      )}
    </div>
  )
}

export function CreativeSection({ data, onAskAI, creativeLabels, onLabelChange, abTestData, onAbTestUpdate }: {
  data: AdData
  onAskAI?: (q: string, autoSend?: boolean) => void
  creativeLabels?: Record<string, Variant>
  onLabelChange?: (adId: string, variant: Variant | null) => void
  abTestData?: { aiDiagnosis: string; winner: string }
  onAbTestUpdate?: (update: AbTestUpdate) => void
}) {
  const [sortBy, setSortBy] = useState<SortBy>('roas')
  const [filter, setFilter] = useState('全部')
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const labels = creativeLabels ?? {}

  const sorted = useMemo(() => {
    let arr = [...data.creatives]
    if (filter !== '全部') arr = arr.filter(c => c.type === filter)
    if (sortBy === 'roas') arr.sort((a, b) => b.roas - a.roas)
    else if (sortBy === 'spend') arr.sort((a, b) => b.spend - a.spend)
    else arr.sort((a, b) => a.cpa - b.cpa)
    return arr
  }, [data.creatives, sortBy, filter])

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="creative" size={15} color="var(--ad-blue)" />
        <span className="ads-section-title">素材庫 &amp; 績效排行</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {onAskAI && <button className="ads-diag-ask-btn" style={{ borderRadius: 7 }} onClick={() => onAskAI('哪支素材表現最好？')}>✨ 問 AI 分析素材</button>}
          <div className="ads-tabs">
            {TYPES.map(t => <button key={t} className={`ads-tab ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>{t}</button>)}
          </div>
          <select
            style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--ad-border)', borderRadius: 7, background: 'var(--ad-surface)', color: 'var(--ad-text2)', cursor: 'pointer', fontFamily: 'var(--font-dm-sans)' }}
            value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
          >
            <option value="roas">點擊效益 ↓</option>
            <option value="spend">花費 ↓</option>
            <option value="cpa">CPA ↑</option>
          </select>
        </div>
      </div>

      {onLabelChange && Object.keys(labels).length > 0 && (
        <ExperimentResultCard creatives={data.creatives} labels={labels} />
      )}

      {sorted.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--ad-text3)', padding: 40 }}>
          尚無廣告素材資料，請先同步廣告數據
        </p>
      )}
      <div className="ads-creative-grid">
        {sorted.map((c, i) => (
          <div key={c.id} className="ads-creative-card" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
              {onLabelChange && (
                <VariantBadge adId={c.id} variant={labels[c.id]} onLabelChange={onLabelChange} />
              )}
              {onAskAI && <button
                title="用 AI 分析此素材"
                onClick={() => onAskAI(buildCreativePrompt(c), true)}
                style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4 }}
              >✨ 分析</button>}
            </div>
            <div className={`ads-creative-thumb ${c.thumb}`}>
              <div className={`ads-creative-rank ${c.status === 'top' ? 'top' : c.status === 'bad' ? 'bad' : ''}`}>{i + 1}</div>
              <div className={`ads-creative-status ${c.status}`}>{STATUS_LABEL[c.status]}</div>
              <span style={{ opacity: 0.5 }}>{c.type} · {c.channel}</span>
            </div>
            <div className="ads-creative-info">
              <div className="ads-creative-name">{renderAdName(c.name)}</div>
              <div className="ads-creative-meta">
                {[['點擊效益', c.roas.toFixed(1) + 'x'], ['花費', fmtK(c.spend)], ['CTR', Number(c.ctr).toFixed(2) + '%'], ['CPA', '$' + c.cpa]].map(([k, v]) => (
                  <div key={k} className="ads-creative-kv">
                    <span style={{ color: 'var(--ad-text3)' }}>{k}</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {labels[c.id] && abTestData && onAbTestUpdate && (
              <>
                <button
                  onClick={() => setExpandedCard(prev => prev === c.id ? null : c.id)}
                  style={{ width: '100%', textAlign: 'center', fontSize: 11, color: 'var(--ad-blue)', background: 'none', border: 'none', borderTop: '1px solid var(--ad-border)', padding: '6px 0', cursor: 'pointer', fontFamily: 'var(--font-dm-sans)' }}
                >
                  查看 A/B 對比 {expandedCard === c.id ? '↑' : '↓'}
                </button>
                <div style={{ overflow: 'hidden', maxHeight: expandedCard === c.id ? '600px' : '0', opacity: expandedCard === c.id ? 1 : 0, transition: 'max-height 0.3s ease, opacity 0.25s ease' }}>
                  <div style={{ padding: '0 8px 8px' }}>
                    <AbTestPanel allCreatives={data.creatives} labels={labels} abTestData={abTestData} onAbTestUpdate={onAbTestUpdate} />
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
