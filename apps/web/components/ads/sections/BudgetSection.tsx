'use client'

import { useState, useMemo, useEffect } from 'react'
import { Icon } from '../Icon'
import type { AdData, Adset, LabelEntry, Experiment } from '../types'

const fmt = (n: number) => n.toLocaleString('zh-TW')
const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${fmt(n)}`
const roasColor = (r: number) => r >= 4 ? 'var(--ad-green)' : r >= 3.5 ? 'var(--ad-blue)' : r >= 2.5 ? 'var(--ad-orange)' : 'var(--ad-red)'

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

type AdsetRow = Adset & { newBudget: number }

export function BudgetSection({ data, creativeLabels, experiments }: {
  data: AdData
  creativeLabels?: Record<string, LabelEntry>
  experiments?: Experiment[]
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convType = (data as any).conversionType as string | undefined
  const isClickBased = convType === 'link_click'
  const isVideoBased = convType === 'video_view'

  // Merge ads tagged in the same A/B experiment into one combined row (budget/spent
  // summed, ROAS/CPA spend-weighted). Untagged ads stay individual.
  const baseAdsets = useMemo<Adset[]>(() => {
    const labels = creativeLabels ?? {}
    const expName = new Map((experiments ?? []).map(e => [e.id, e.name]))
    const groups = new Map<string, Adset[]>()
    const singles: Adset[] = []
    for (const a of data.budget.adsets) {
      const expId = a.id ? labels[a.id]?.experimentId : undefined
      if (expId) {
        const arr = groups.get(expId) ?? []
        arr.push(a)
        groups.set(expId, arr)
      } else {
        singles.push(a)
      }
    }
    const merged: Adset[] = []
    for (const [expId, members] of Array.from(groups.entries())) {
      if (members.length < 2) { merged.push(members[0]); continue }
      const budget = members.reduce((s, m) => s + m.budget, 0)
      const spent = members.reduce((s, m) => s + m.spent, 0)
      const roas = spent > 0
        ? members.reduce((s, m) => s + m.roas * m.spent, 0) / spent
        : members.reduce((s, m) => s + m.roas, 0) / members.length
      const cpa = spent > 0 ? members.reduce((s, m) => s + m.cpa * m.spent, 0) / spent : 0
      merged.push({
        id: `exp:${expId}`,
        name: `🧪 ${expName.get(expId) || '實驗'}（A/B 合併 ${members.length} 組）`,
        budget, spent, roas: Number(roas.toFixed(2)), cpa: Math.round(cpa),
      })
    }
    return [...merged, ...singles]
  }, [data.budget.adsets, creativeLabels, experiments])

  const [adsets, setAdsets] = useState<AdsetRow[]>(baseAdsets.map(a => ({ ...a, newBudget: a.budget })))
  useEffect(() => { setAdsets(baseAdsets.map(a => ({ ...a, newBudget: a.budget }))) }, [baseAdsets])

  const sliderMax = Math.max(...baseAdsets.map(a => a.budget)) * 3 || 200000
  const sliderStep = sliderMax > 50000 ? 5000 : 100

  const totalNew = adsets.reduce((s, a) => s + a.newBudget, 0)
  const totalOrig = adsets.reduce((s, a) => s + a.budget, 0)
  const projRoas = adsets.reduce((s, a) => s + a.roas * a.newBudget, 0) / totalNew
  const hasRoasData = adsets.some(a => a.roas > 0)

  const update = (i: number, v: number) => setAdsets(p => p.map((a, j) => j === i ? { ...a, newBudget: Math.max(0, v) } : a))

  const applyAI = () => setAdsets(p => p.map(a => ({
    ...a,
    newBudget: a.roas >= 4 ? Math.round(a.budget * 1.3)
      : a.roas < 2 ? Math.round(a.budget * 0.5)
        : a.budget,
  })))

  const reset = () => setAdsets(baseAdsets.map(a => ({ ...a, newBudget: a.budget })))

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="budget" size={15} color="var(--ad-blue)" />
        <span className="ads-section-title">預算分配模擬器</span>
      </div>

      <div className="ads-card ads-card-pad">
        <div className="ads-sim-controls">
          <div style={{ fontSize: 13 }}>
            模擬總預算：<strong style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 15 }}>{fmtK(totalNew)}</strong>
            <span style={{ marginLeft: 6, fontSize: 12, color: totalNew > totalOrig ? 'var(--ad-orange)' : totalNew < totalOrig ? 'var(--ad-green)' : 'var(--ad-text3)' }}>
              {totalNew !== totalOrig ? `${totalNew > totalOrig ? '↑' : '↓'} ${fmtK(Math.abs(totalNew - totalOrig))}` : '(原預算)'}
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {isVideoBased ? '模擬觀看效益：' : isClickBased ? '模擬效益：' : '模擬 ROAS：'}
            {hasRoasData
              ? <span style={{ fontFamily: 'var(--font-dm-mono)', color: roasColor(projRoas), fontSize: 15 }}>{projRoas.toFixed(2)}{isVideoBased || isClickBased ? '次/百元' : 'x'}</span>
              : <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--ad-text3)', fontSize: 13 }}>無花費數據（過去 30 天尚無記錄）</span>
            }
          </div>
          <button className="ads-btn" style={{ marginLeft: 'auto' }} onClick={applyAI}>✨ AI 自動最佳化</button>
          <button className="ads-btn" onClick={reset}>重置</button>
        </div>

        <table className="ads-budget-table">
          <thead>
            <tr>
              <th>廣告組合</th><th>原始預算</th><th>花費進度</th><th>{isVideoBased ? '觀看效益' : isClickBased ? '效益指數' : 'ROAS'}</th><th>{isVideoBased ? 'CPV' : isClickBased ? 'CPC' : 'CPA'}</th><th>模擬預算</th>
            </tr>
          </thead>
          <tbody>
            {adsets.map((a, i) => {
              const pct = (a.spent / a.budget) * 100
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500, lineHeight: 1.4 }}>{renderAdName(a.name)}</td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmtK(a.budget)}</span></td>
                  <td>
                    <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 3 }}>{fmtK(a.spent)} ({pct.toFixed(0)}%)</div>
                    <div className="ads-prog-bar">
                      <div className="ads-prog-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pct > 90 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
                    </div>
                  </td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 600, color: a.roas > 0 ? roasColor(a.roas) : 'var(--ad-text3)' }}>{a.roas > 0 ? `${a.roas.toFixed(1)}${isVideoBased || isClickBased ? '' : 'x'}` : '–'}</span></td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)', color: a.cpa > 0 ? 'var(--ad-text)' : 'var(--ad-text3)' }}>{a.cpa > 0 ? `$${a.cpa}` : '–'}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="range" min={0} max={sliderMax} step={sliderStep} value={a.newBudget}
                        onChange={e => update(i, Number(e.target.value))}
                        style={{ width: 88, accentColor: 'var(--ad-blue)' }} />
                      <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12.5, fontWeight: 600, minWidth: 50, color: a.newBudget > a.budget ? 'var(--ad-green)' : a.newBudget < a.budget ? 'var(--ad-red)' : 'var(--ad-text)' }}>
                        {fmtK(a.newBudget)}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
