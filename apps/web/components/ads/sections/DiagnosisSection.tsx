'use client'

import { useState } from 'react'
import { Icon } from '../Icon'
import type { AdData, Post, AiDiagCard } from '../types'
import { diagnosisCardKey, severityRank } from '@/lib/ads/diagnosisCardKey'

export type CardStatus = 'completed' | 'dismissed'

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

export function DiagnosisSection({ data, posts, aiCards, cardStatuses, canManage, onCardAction, onAskAI }: {
  data: AdData
  posts?: Post[] | null
  aiCards?: AiDiagCard[] | null
  cardStatuses?: Record<string, CardStatus>
  canManage?: boolean
  onCardAction?: (cardKey: string, status: CardStatus | 'open', severityRank?: number) => void
  onAskAI?: (q: string) => void
}) {
  const postList = posts ?? []
  const cardMap = new Map((aiCards ?? []).map(c => [c.refId, c]))
  const statuses = cardStatuses ?? {}
  const statusOf = (d: { type: string; storyId?: string | null; adset?: string }): CardStatus | 'open' =>
    statuses[diagnosisCardKey(d)] ?? 'open'
  const [tab, setTab] = useState<'open' | 'completed' | 'dismissed'>('open')
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

  // Prefer the Agent's narrative (first `why` of each card) when available;
  // otherwise fall back to the rule-template summary above.
  const summaryText = (aiCards && aiCards.length > 0)
    ? aiCards.map(c => c.why[0]).filter(Boolean).join(' ')
    : aiSummary

  // Open / Completed / Dismissed buckets (Madgicx-style).
  const counts = { open: 0, completed: 0, dismissed: 0 }
  for (const d of data.diagnosis) counts[statusOf(d)]++
  const visibleItems = data.diagnosis.filter(d => statusOf(d) === tab)
  const tabs: { id: 'open' | 'completed' | 'dismissed'; label: string }[] = [
    { id: 'open', label: '待處理' }, { id: 'completed', label: '已完成' }, { id: 'dismissed', label: '已略過' },
  ]

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
          <div className="ads-ai-text">{summaryText}</div>
        </div>
        {onAskAI && <button className="ads-diag-ask-btn" style={{ alignSelf: 'flex-start', flexShrink: 0 }} onClick={() => onAskAI('建議我本週的操作清單')}>
          問 AI ›
        </button>}
      </div>

      {/* Open / Completed / Dismissed tabs */}
      <div style={{ display: 'flex', gap: 18, borderBottom: '1px solid var(--ad-border)', margin: '4px 0 14px' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? 'var(--ad-blue)' : 'var(--ad-text3)',
              borderBottom: tab === t.id ? '2px solid var(--ad-blue)' : '2px solid transparent', marginBottom: -1 }}>
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>

      <div className="ads-diag-list">
        {visibleItems.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ad-text3)', padding: '20px 4px' }}>
            {tab === 'open' ? '目前沒有待處理的建議 🎉' : tab === 'completed' ? '尚無已完成的建議。' : '尚無已略過的建議。'}
          </div>
        )}
        {visibleItems.map(d => {
          const postUrl = resolvePostLink(d.storyId, d.adset, postList)
          const hasPreview = !!(d.thumbnailUrl || postUrl)
          const card = cardMap.get(d.id)            // Agent rewrite (may be undefined → rule fallback)
          const cardKey = diagnosisCardKey(d)
          const st = statusOf(d)
          return (
          <div key={d.id} className={`ads-diag-item ${d.severity}`}>
            <div className={`ads-diag-icon ${d.severity}`}>{icons[d.severity]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="ads-diag-title">{card?.title ?? d.title}</div>
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

              {/* Agent narrative (Madgicx-style: why → impact → benchmark) or rule desc */}
              {card ? (
                <>
                  <div className="ads-diag-desc">{card.why.join(' ')}</div>
                  {card.impact && <div className="ads-diag-desc" style={{ fontWeight: 600, color: lc[d.severity][1], marginTop: 4 }}>{card.impact}</div>}
                  {card.benchmark && <div className="ads-diag-desc" style={{ color: 'var(--ad-text3)', marginTop: 4 }}>📊 {card.benchmark}</div>}
                </>
              ) : (
                <div className="ads-diag-desc">{d.desc}</div>
              )}
              <div className="ads-diag-footer">
                <span className="ads-diag-chip metric">{d.metric}</span>
                <span className="ads-diag-chip metric">門檻 {d.threshold}</span>
                <span className="ads-diag-chip action">建議：{card?.cta.label ?? d.action}</span>
                {onAskAI && <button className="ads-diag-ask-btn" onClick={() => onAskAI(card?.cta.askAi ?? askQ[d.id] ?? '建議我本週的操作清單')}>
                  ✨ 問 AI
                </button>}
              </div>

              {/* Action buttons (Madgicx-style: mark complete / skip / reopen). Admin only. */}
              {canManage && onCardAction && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {st === 'open' ? (
                    <>
                      <button onClick={() => onCardAction(cardKey, 'completed', severityRank(d.severity))}
                        style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                          border: '1px solid var(--ad-green, #22a06b)', background: 'var(--ad-green, #22a06b)', color: '#fff' }}>
                        ✓ 標記完成
                      </button>
                      <button onClick={() => onCardAction(cardKey, 'dismissed')}
                        style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                          border: '1px solid var(--ad-border)', background: 'var(--ad-surface)', color: 'var(--ad-text2)' }}>
                        略過
                      </button>
                    </>
                  ) : (
                    <button onClick={() => onCardAction(cardKey, 'open')}
                      style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                        border: '1px solid var(--ad-border)', background: 'var(--ad-surface)', color: 'var(--ad-text2)' }}>
                      ↩ 重新開啟
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
