'use client'

import { Icon } from '../Icon'
import type { AdData, Post } from '../types'

// Normalize a title/name for fuzzy matching (strip punctuation/brackets/spaces).
function normalizeName(s: string): string {
  return (s || '').replace(/[「」『』《》【】\[\]()（）"'：:、，。.,#＃\s]/g, '').toLowerCase()
}

// Name-based match: if the creative/diagnosis name and a post's title share a
// meaningful leading chunk, treat them as the same post. Handles the case where
// the ad has no storyId but its name echoes the post text (e.g. 《Legacy 看板人物 #9》).
export function matchPostByName(name: string | null | undefined, posts: Post[]): string {
  const n = normalizeName(name ?? '')
  if (n.length < 4) return ''
  for (const p of posts) {
    const t = normalizeName(p.title)
    if (t.length < 4 || !p.url || p.url === '#') continue
    // Match if either string starts-with the other's leading 6+ chars, or one contains the other.
    const a = n.slice(0, 8), b = t.slice(0, 8)
    if (n.includes(b) || t.includes(a) || t.startsWith(a.slice(0, 6)) || n.startsWith(b.slice(0, 6))) {
      return p.url
    }
  }
  return ''
}

// Resolve a clickable FB/IG post URL for a diagnosis item.
// 1) match creative storyId to a synced post  2) match by name  3) constructed FB URL.
function resolvePostLink(storyId: string | null | undefined, name: string | null | undefined, posts: Post[]): string | null {
  if (storyId) {
    const postId = storyId.includes('_') ? storyId.split('_').slice(1).join('_') : storyId
    const match = posts.find(p => p.id === storyId || p.id === postId || p.id.endsWith(`_${postId}`))
    if (match?.url && match.url !== '#') return match.url
  }
  const byName = matchPostByName(name, posts)
  if (byName) return byName
  if (storyId) return `https://www.facebook.com/${storyId}`
  return null
}

export function DiagnosisSection({ data, posts, onAskAI }: { data: AdData; posts?: Post[] | null; onAskAI?: (q: string) => void }) {
  const postList = posts ?? []
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
    c1: '這篇貼文要怎麼投廣告加碼推廣？', c2: '為什麼我的貼文互動下滑了？', c3: '我應該多久發一次文？',
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
        {data.diagnosis.map(d => {
          const postUrl = resolvePostLink(d.storyId, d.adset, postList)
          const hasPreview = !!(d.thumbnailUrl || postUrl)
          return (
          <div key={d.id} className={`ads-diag-item ${d.severity}`}>
            <div className={`ads-diag-icon ${d.severity}`}>{icons[d.severity]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="ads-diag-title">{d.title}</div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: lc[d.severity][0], color: lc[d.severity][1] }}>
                  {labels[d.severity]}
                </span>
              </div>

              {/* Creative preview: thumbnail + post link */}
              {hasPreview && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                  {d.thumbnailUrl && (
                    postUrl ? (
                      <a href={postUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, lineHeight: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={d.thumbnailUrl} alt="貼文預覽" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--ad-border)' }} />
                      </a>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={d.thumbnailUrl} alt="貼文預覽" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--ad-border)' }} />
                    )
                  )}
                  {postUrl && (
                    <a href={postUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--ad-blue)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      查看貼文 ↗
                    </a>
                  )}
                </div>
              )}

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
          )
        })}
      </div>
    </div>
  )
}
