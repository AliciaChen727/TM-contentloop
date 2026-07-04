'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface IgStory {
  id: string
  platform?: 'IG' | 'FB'
  mediaType: 'STORY'
  mediaSubType: 'IMAGE' | 'VIDEO'
  thumbnailUrl: string
  permalink: string
  timestamp: string
  caption?: string
  insights: {
    reach: number
    views: number
    replies: number
    tapForward: number
    tapBack: number
    tapExit: number
    swipeForward: number
  }
}

type SortKey = 'timestamp' | 'views' | 'reach' | 'replies' | 'skipRate'

const fmt = (n: number) => n.toLocaleString('zh-TW')

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// 略過率 ≈ (往前點 + 跳出 + 滑到下一個帳號) ÷ 觀看數。回看(tap_back)屬正向，不計。
// Meta 沒有真正的影片完播率，這是用導航行為反推的近似值。
function skipRate(s: IgStory): number | null {
  const base = s.insights.views || s.insights.reach
  if (base <= 0) return null
  const left = s.insights.tapForward + s.insights.tapExit + s.insights.swipeForward
  if (left === 0) return null
  return left / base
}

function SortTh({ k, label, sortKey, sortDir, onSort }: {
  k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void
}) {
  return (
    <th className={sortKey === k ? 'sorted' : ''} onClick={() => onSort(k)} style={{ cursor: 'pointer' }}>
      {label}
      <span style={{ marginLeft: 4, opacity: sortKey === k ? 1 : 0.4, fontSize: 10, color: sortKey === k ? 'var(--ad-blue)' : undefined }}>
        {sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </th>
  )
}

function buildStoryPrompt(s: IgStory, en: boolean): string {
  const rate = skipRate(s)
  if (en) return `Please analyze this Instagram Story:\nDate: ${s.timestamp.slice(0, 10)} | Type: Story ${s.mediaSubType === 'VIDEO' ? 'video' : 'image'}\nContent: ${s.caption || '(no text)'}\nViews: ${s.insights.views} | Reach: ${s.insights.reach} | Replies: ${s.insights.replies} | Skip rate: ${rate != null ? (rate * 100).toFixed(1) + '%' : 'no data'}\n\nPlease assess this Story's appeal and retention, and give specific optimization suggestions.`
  return `請分析這則 Instagram 限動：\n日期：${s.timestamp.slice(0, 10)}｜類型：限動${s.mediaSubType === 'VIDEO' ? '影片' : '圖片'}\n內容：${s.caption || '（無文字內容）'}\n觀看：${s.insights.views}｜觸及：${s.insights.reach}｜回覆：${s.insights.replies}｜略過率：${rate != null ? (rate * 100).toFixed(1) + '%' : '無資料'}\n\n請判斷這則限動的吸引力與留存表現，並給出具體優化建議。`
}

export function IgStoriesTable({ stories, onAskAI }: { stories: IgStory[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!stories.length) {
    return (
      <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>
        {L('尚無限動資料。IG 限動需在發布後 24 小時內、限動還在線時按同步收集；FB 粉專限動會自動同步（含典藏的舊限動），但 Meta 多半不提供其觸及／觀看數。', 'No Story data yet. IG Stories must be synced within 24 hours of posting while they are still live; FB Page Stories sync automatically (including archived ones), though Meta usually does not provide reach/views for them.')}
      </p>
    )
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...stories].sort((a, b) => {
    let av: number, bv: number
    if (sortKey === 'timestamp') {
      av = new Date(a.timestamp).getTime()
      bv = new Date(b.timestamp).getTime()
    } else if (sortKey === 'skipRate') {
      av = skipRate(a) ?? -1
      bv = skipRate(b) ?? -1
    } else {
      av = a.insights[sortKey]
      bv = b.insights[sortKey]
    }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ads-posts-table">
        <thead>
          <tr>
            <SortTh k="timestamp" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>{L('內容', 'Content')}</th>
            <th style={{ textAlign: 'left' }}>{L('類型', 'Type')}</th>
            <th style={{ textAlign: 'left' }}>{L('限動', 'Story')}</th>
            <SortTh k="views" label={L('觀看', 'Views')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="reach" label={L('觸及', 'Reach')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="replies" label={L('回覆', 'Replies')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="skipRate" label={L('略過率', 'Skip rate')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => {
            const rate = skipRate(s)
            const isVideo = s.mediaSubType === 'VIDEO'
            return (
              <tr key={s.id}>
                <td className="ads-posts-date">{fullDate(s.timestamp)}</td>
                <td style={{ maxWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Story media is video/image with text baked in — show the thumbnail
                        as the "content" since the caption is usually empty. */}
                    {s.thumbnailUrl ? (
                      s.permalink ? (
                        <a href={s.permalink} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, lineHeight: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.thumbnailUrl} alt={L('限動截圖', 'Story screenshot')} width={36} height={48}
                            style={{ borderRadius: 6, objectFit: 'cover', background: '#f3f4f6', border: '1px solid var(--ad-border)' }}
                            onError={e => { e.currentTarget.style.display = 'none' }} />
                        </a>
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={s.thumbnailUrl} alt={L('限動截圖', 'Story screenshot')} width={36} height={48}
                          style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0, background: '#f3f4f6', border: '1px solid var(--ad-border)' }}
                          onError={e => { e.currentTarget.style.display = 'none' }} />
                      )
                    ) : null}
                    <div style={{ fontSize: 13, color: 'var(--ad-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.caption || L('（影音內容，文字在畫面中）', '(media content; text is in the image)')}>
                      {s.caption ? s.caption : <span style={{ color: 'var(--ad-text3)' }}>{s.thumbnailUrl ? L('（影音內容）', '(media content)') : L('（無文字內容）', '(no text)')}</span>}
                    </div>
                  </div>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: s.platform === 'FB' ? '#E7F0FF' : '#FCE4EC', color: s.platform === 'FB' ? '#1877F2' : '#C2185B' }}>
                      {s.platform === 'FB' ? 'FB' : 'IG'}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#F3E5F5', color: '#6A1B9A' }}>
                      {isVideo ? L('◐ 限動影片', '◐ Story video') : L('◐ 限動圖片', '◐ Story image')}
                    </span>
                  </span>
                </td>
                <td style={{ maxWidth: 200 }}>
                  {s.permalink ? (
                    <a
                      href={s.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-blue)', textDecoration: 'none' }}
                    >{L('查看限動 ↗', 'View Story ↗')}</a>
                  ) : (
                    <span style={{ fontSize: 12.5, color: 'var(--ad-text3)' }}>{L('（已過期）', '(expired)')}</span>
                  )}
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {s.insights.views > 0 ? fmt(s.insights.views) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(s.insights.reach)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(s.insights.replies)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: 600, color: rate == null ? 'var(--ad-text3)' : rate >= 0.5 ? 'var(--ad-red, #c0392b)' : rate <= 0.2 ? 'var(--ad-green)' : undefined }}>
                  {rate != null ? `${(rate * 100).toFixed(1)}%` : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
                {onAskAI && (
                  <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                    <button
                      title={L('用 AI 分析此限動', 'Analyze this Story with AI')}
                      onClick={() => onAskAI(buildStoryPrompt(s, en), true)}
                      style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                    >✨ {L('分析', 'Analyze')}</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)' }}>
        {L(`共 ${stories.length} 則限動 · 略過率為導航行為近似值，非逐秒完播率`, `${stories.length} Stories · skip rate is a navigation-behavior approximation, not a per-second completion rate`)}
      </div>
    </div>
  )
}
