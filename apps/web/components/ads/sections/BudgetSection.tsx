'use client'

import { useState, useMemo, useEffect, Fragment } from 'react'
import { Icon } from '../Icon'
import type { AdData, Adset, LabelEntry, Experiment } from '../types'
import { useLang } from '@/lib/i18n/LanguageProvider'

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

type MergedAdset = Adset & { members?: Adset[] }
type AdsetRow = MergedAdset & { newBudget: number }

export function BudgetSection({ data, creativeLabels, experiments }: {
  data: AdData
  creativeLabels?: Record<string, LabelEntry>
  experiments?: Experiment[]
}) {
  const { L } = useLang()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convType = (data as any).conversionType as string | undefined
  const isClickBased = convType === 'link_click'
  const isVideoBased = convType === 'video_view'

  // Merge ads tagged in the same A/B experiment into one combined row (budget/spent
  // summed, ROAS/CPA spend-weighted). Untagged ads stay individual.
  const baseAdsets = useMemo<MergedAdset[]>(() => {
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
    const merged: MergedAdset[] = []
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
        name: L(`🧪 ${expName.get(expId) || '實驗'}（A/B 合併 ${members.length} 組）`, `🧪 ${expName.get(expId) || 'Experiment'} (A/B merged ${members.length})`),
        budget, spent, roas: Number(roas.toFixed(2)), cpa: Math.round(cpa),
        members,
      })
    }
    return [...merged, ...singles]
  }, [data.budget.adsets, creativeLabels, experiments])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(p => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const [adsets, setAdsets] = useState<AdsetRow[]>(baseAdsets.map(a => ({ ...a, newBudget: a.budget })))
  useEffect(() => { setAdsets(baseAdsets.map(a => ({ ...a, newBudget: a.budget }))) }, [baseAdsets])

  const sliderMax = Math.max(...baseAdsets.map(a => a.budget)) * 3 || 200000
  const sliderStep = sliderMax > 50000 ? 5000 : 100

  // Diminishing-returns model: efficiency drops / CPC rises as you pour in more
  // budget (and vice-versa). simEff = roas × ratio^-DR, simCpc = cpc × ratio^DR.
  const DR = 0.15
  const simMetrics = (a: AdsetRow) => {
    const ratio = a.budget > 0 && a.newBudget > 0 ? a.newBudget / a.budget : 1
    const f = Math.pow(ratio, DR)
    return {
      roas: a.roas > 0 ? a.roas / f : 0,
      cpc: a.cpa > 0 ? a.cpa * f : 0,
    }
  }

  const totalNew = adsets.reduce((s, a) => s + a.newBudget, 0)
  const totalOrig = adsets.reduce((s, a) => s + a.budget, 0)
  const projRoas = totalNew > 0 ? adsets.reduce((s, a) => s + simMetrics(a).roas * a.newBudget, 0) / totalNew : 0
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
        <span className="ads-section-title">{L('預算分配模擬器', 'Budget Allocation Simulator')}</span>
      </div>

      <div className="ads-card ads-card-pad">
        <div className="ads-sim-controls">
          <div style={{ fontSize: 13 }}>
            {L('模擬總預算：', 'Simulated total budget: ')}<strong style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 15 }}>{fmtK(totalNew)}</strong>
            <span style={{ marginLeft: 6, fontSize: 12, color: totalNew > totalOrig ? 'var(--ad-orange)' : totalNew < totalOrig ? 'var(--ad-green)' : 'var(--ad-text3)' }}>
              {totalNew !== totalOrig ? `${totalNew > totalOrig ? '↑' : '↓'} ${fmtK(Math.abs(totalNew - totalOrig))}` : L('(原預算)', '(original)')}
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {isVideoBased ? L('模擬觀看效益：', 'Simulated view value: ') : isClickBased ? L('模擬效益：', 'Simulated value: ') : L('模擬 ROAS：', 'Simulated ROAS: ')}
            {hasRoasData
              ? <span style={{ fontFamily: 'var(--font-dm-mono)', color: roasColor(projRoas), fontSize: 15 }}>{projRoas.toFixed(2)}{isVideoBased || isClickBased ? L('次/百元', '/NT$100') : 'x'}</span>
              : <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--ad-text3)', fontSize: 13 }}>{L('無花費數據（過去 30 天尚無記錄）', 'No spend data (none in the last 30 days)')}</span>
            }
          </div>
          <button className="ads-btn" style={{ marginLeft: 'auto' }} onClick={applyAI}>{L('✨ AI 自動最佳化', '✨ AI auto-optimize')}</button>
          <button className="ads-btn" onClick={reset}>{L('重置', 'Reset')}</button>
        </div>

        <table className="ads-budget-table">
          <thead>
            <tr>
              <th>{L('廣告組合', 'Ad set')}</th><th>{L('原始預算', 'Original budget')}</th><th>{L('花費進度', 'Spend progress')}</th><th>{isVideoBased ? L('觀看效益', 'View value') : isClickBased ? L('效益指數', 'Value index') : 'ROAS'}</th><th>{isVideoBased ? 'CPV' : isClickBased ? 'CPC' : 'CPA'}</th><th>{L('模擬預算', 'Sim budget')}</th><th>{isVideoBased ? L('模擬觀看效益', 'Sim view value') : isClickBased ? L('模擬效益指數', 'Sim value index') : L('模擬ROAS', 'Sim ROAS')}</th><th>{isVideoBased ? L('模擬CPV', 'Sim CPV') : isClickBased ? L('模擬CPC', 'Sim CPC') : L('模擬CPA', 'Sim CPA')}</th>
            </tr>
          </thead>
          <tbody>
            {adsets.map((a, i) => {
              const pct = (a.spent / a.budget) * 100
              const rowId = a.id ?? String(i)
              const isMerged = (a.members?.length ?? 0) > 1
              const isOpen = expanded.has(rowId)
              return (
                <Fragment key={rowId}>
                  <tr>
                    <td style={{ fontWeight: 500, lineHeight: 1.4 }}>
                      {isMerged && (
                        <button
                          onClick={() => toggleExpand(rowId)}
                          title={isOpen ? L('收合個別廣告', 'Collapse individual ads') : L('展開個別廣告', 'Expand individual ads')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 11, marginRight: 4, padding: 0 }}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      )}
                      {renderAdName(a.name)}
                    </td>
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
                    {(() => {
                      const sim = simMetrics(a)
                      const effUp = sim.roas >= a.roas
                      const cpcDown = sim.cpc <= a.cpa
                      return (
                        <>
                          <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 600, color: sim.roas > 0 ? (effUp ? 'var(--ad-green)' : 'var(--ad-red)') : 'var(--ad-text3)' }}>{sim.roas > 0 ? `${sim.roas.toFixed(1)}${isVideoBased || isClickBased ? '' : 'x'}` : '–'}</span></td>
                          <td><span style={{ fontFamily: 'var(--font-dm-mono)', color: sim.cpc > 0 ? (cpcDown ? 'var(--ad-green)' : 'var(--ad-red)') : 'var(--ad-text3)' }}>{sim.cpc > 0 ? `$${sim.cpc.toFixed(1)}` : '–'}</span></td>
                        </>
                      )
                    })()}
                  </tr>
                  {isMerged && isOpen && a.members!.map((m, mi) => {
                    const mpct = m.budget > 0 ? (m.spent / m.budget) * 100 : 0
                    return (
                      <tr key={`${rowId}-m${mi}`} style={{ background: 'var(--ad-surface2)' }}>
                        <td style={{ paddingLeft: 28, fontSize: 12.5, color: 'var(--ad-text2)', lineHeight: 1.4 }}>{renderAdName(m.name)}</td>
                        <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12.5, color: 'var(--ad-text2)' }}>{fmtK(m.budget)}</span></td>
                        <td>
                          <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 3 }}>{fmtK(m.spent)} ({mpct.toFixed(0)}%)</div>
                          <div className="ads-prog-bar">
                            <div className="ads-prog-fill" style={{ width: `${Math.min(mpct, 100)}%`, background: mpct > 90 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
                          </div>
                        </td>
                        <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12.5, color: m.roas > 0 ? roasColor(m.roas) : 'var(--ad-text3)' }}>{m.roas > 0 ? `${m.roas.toFixed(1)}${isVideoBased || isClickBased ? '' : 'x'}` : '–'}</span></td>
                        <td><span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12.5, color: m.cpa > 0 ? 'var(--ad-text2)' : 'var(--ad-text3)' }}>{m.cpa > 0 ? `$${m.cpa}` : '–'}</span></td>
                        <td><span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>—</span></td>
                        <td><span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>—</span></td>
                        <td><span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>—</span></td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
