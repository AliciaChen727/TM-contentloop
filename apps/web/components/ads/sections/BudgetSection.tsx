'use client'

import { useState } from 'react'
import { Icon } from '../Icon'
import type { AdData, Adset } from '../types'

const fmt = (n: number) => n.toLocaleString('zh-TW')
const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${fmt(n)}`
const roasColor = (r: number) => r >= 4 ? 'var(--ad-green)' : r >= 3.5 ? 'var(--ad-blue)' : r >= 2.5 ? 'var(--ad-orange)' : 'var(--ad-red)'

type AdsetRow = Adset & { newBudget: number }

export function BudgetSection({ data }: { data: AdData }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isClickBased = (data as any).conversionType === 'link_click'
  const [adsets, setAdsets] = useState<AdsetRow[]>(data.budget.adsets.map(a => ({ ...a, newBudget: a.budget })))
  const sliderMax = Math.max(...data.budget.adsets.map(a => a.budget)) * 3 || 200000
  const sliderStep = sliderMax > 50000 ? 5000 : 100

  const totalNew = adsets.reduce((s, a) => s + a.newBudget, 0)
  const totalOrig = adsets.reduce((s, a) => s + a.budget, 0)
  const projRoas = adsets.reduce((s, a) => s + a.roas * a.newBudget, 0) / totalNew

  const update = (i: number, v: number) => setAdsets(p => p.map((a, j) => j === i ? { ...a, newBudget: Math.max(0, v) } : a))

  const applyAI = () => setAdsets(p => p.map(a => ({
    ...a,
    newBudget: a.roas >= 4 ? Math.round(a.budget * 1.3)
      : a.roas < 2 ? Math.round(a.budget * 0.5)
        : a.budget,
  })))

  const reset = () => setAdsets(data.budget.adsets.map(a => ({ ...a, newBudget: a.budget })))

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
            {isClickBased ? '模擬效益：' : '模擬 ROAS：'}<span style={{ fontFamily: 'var(--font-dm-mono)', color: roasColor(projRoas), fontSize: 15 }}>{projRoas.toFixed(2)}{isClickBased ? '次/百元' : 'x'}</span>
          </div>
          <button className="ads-btn" style={{ marginLeft: 'auto' }} onClick={applyAI}>✨ AI 自動最佳化</button>
          <button className="ads-btn" onClick={reset}>重置</button>
        </div>

        <table className="ads-budget-table">
          <thead>
            <tr>
              <th>廣告組合</th><th>原始預算</th><th>花費進度</th><th>{isClickBased ? '效益指數' : 'ROAS'}</th><th>{isClickBased ? 'CPC' : 'CPA'}</th><th>模擬預算</th>
            </tr>
          </thead>
          <tbody>
            {adsets.map((a, i) => {
              const pct = (a.spent / a.budget) * 100
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{a.name}</td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmtK(a.budget)}</span></td>
                  <td>
                    <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 3 }}>{fmtK(a.spent)} ({pct.toFixed(0)}%)</div>
                    <div className="ads-prog-bar">
                      <div className="ads-prog-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pct > 90 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
                    </div>
                  </td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 600, color: roasColor(a.roas) }}>{a.roas.toFixed(1)}{isClickBased ? '' : 'x'}</span></td>
                  <td><span style={{ fontFamily: 'var(--font-dm-mono)' }}>${a.cpa}</span></td>
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
