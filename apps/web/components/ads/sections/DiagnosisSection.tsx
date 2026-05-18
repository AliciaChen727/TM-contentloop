'use client'

import { Icon } from '../Icon'
import type { AdData } from '../types'

export function DiagnosisSection({ data, onAskAI }: { data: AdData; onAskAI?: (q: string) => void }) {
  const icons: Record<string, string> = { critical: '🚨', warning: '⚠️', good: '✅' }
  const labels: Record<string, string> = { critical: '嚴重', warning: '警告', good: '優化機會' }
  const lc: Record<string, [string, string]> = {
    critical: ['var(--ad-red-light)', 'var(--ad-red)'],
    warning: ['var(--ad-orange-light)', 'var(--ad-orange)'],
    good: ['var(--ad-green-light)', 'var(--ad-green)'],
  }
  const askQ: Record<string, string> = {
    d1: '我的受眾是否疲乏了？', d2: 'CPA 為什麼偏高？',
    d3: '預算怎麼分配最划算？', d4: '哪支素材表現最好？', d5: '哪個廣告組合應該增加預算？',
  }
  const criticalCount = data.diagnosis.filter(d => d.severity === 'critical').length
  const warningCount = data.diagnosis.filter(d => d.severity === 'warning').length

  const aiSummary = (() => {
    const criticals = data.diagnosis.filter(d => d.severity === 'critical')
    const warnings = data.diagnosis.filter(d => d.severity === 'warning')
    const goods = data.diagnosis.filter(d => d.severity === 'good')
    const parts: string[] = [
      ...criticals.map(d => `${d.desc}建議：${d.action}。`),
      ...warnings.map(d => `${d.desc}建議：${d.action}。`),
      ...goods.map(d => d.desc),
    ]
    return parts.length > 0
      ? `根據目前帳戶狀況：${parts.join('同時，')}`
      : '帳戶整體運作正常，暫無需緊急處理的問題，請持續監控每日成效。'
  })()

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="alert" size={15} color="var(--ad-orange)" />
        <span className="ads-section-title">診斷 &amp; 智慧建議</span>
        <span style={{ background: 'var(--ad-red-light)', color: 'var(--ad-red)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>{criticalCount} 嚴重</span>
        <span style={{ background: 'var(--ad-orange-light)', color: 'var(--ad-orange)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>{warningCount} 警告</span>
      </div>

      <div className="ads-ai-box">
        <div style={{ fontSize: 20, flexShrink: 0 }}>✨</div>
        <div style={{ flex: 1 }}>
          <div className="ads-ai-label">AI 投手建議</div>
          <div className="ads-ai-text">{aiSummary}</div>
        </div>
        {onAskAI && <button className="ads-diag-ask-btn" style={{ alignSelf: 'flex-start', flexShrink: 0 }} onClick={() => onAskAI('建議我本週的操作清單')}>
          問 AI ›
        </button>}
      </div>

      <div className="ads-diag-list">
        {data.diagnosis.map(d => (
          <div key={d.id} className={`ads-diag-item ${d.severity}`}>
            <div className={`ads-diag-icon ${d.severity}`}>{icons[d.severity]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="ads-diag-title">{d.title}</div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: lc[d.severity][0], color: lc[d.severity][1] }}>
                  {labels[d.severity]}
                </span>
              </div>
              <div className="ads-diag-desc">{d.desc}</div>
              <div className="ads-diag-footer">
                <span className="ads-diag-chip metric">{d.metric}</span>
                <span className="ads-diag-chip metric">門檻 {d.threshold}</span>
                <span className="ads-diag-chip action">建議：{d.action}</span>
                {onAskAI && <button className="ads-diag-ask-btn" onClick={() => onAskAI(askQ[d.id] ?? '建議我本週的操作清單')}>
                  ✨ 問 AI
                </button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
