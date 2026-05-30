'use client'

import { useState } from 'react'

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

function buildStoryPrompt(s: IgStory): string {
  const rate = skipRate(s)
  return `請分析這則 Instagram 限動：\n日期：${s.timestamp.slice(0, 10)}｜類型：限動${s.mediaSubType === 'VIDEO' ? '影片' : '圖片'}\n內容：${s.caption || '（無文字內容）'}\n觀看：${s.insights.views}｜觸及：${s.insights.reach}｜回覆：${s.insights.replies}｜略過率：${rate != null ? (rate * 100).toFixed(1) + '%' : '無資料'}\n\n請判斷這則限動的吸引力與留存表現，並給出具體優化建議。`
}

export function IgStoriesTable({ stories, onAskAI }: { stories: IgStory[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!stories.length) {
    return (
      <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>
        尚無限動資料。IG 限動需在發布後 24 小時內、限動還在線時按同步收集。（FB 粉專限動目前 Meta API 無法讀取手動發布的限動，請改用「上傳圖片」分析。）
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
            <SortTh k="timestamp" label="日期" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>內容</th>
            <th style={{ textAlign: 'left' }}>類型</th>
            <th style={{ textAlign: 'left' }}>限動</th>
            <SortTh k="views" label="觀看" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="reach" label="觸及" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="replies" label="回覆" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="skipRate" label="略過率" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
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
                <td style={{ maxWidth: 200 }}>
                  <div style={{ fontSize: 13, color: 'var(--ad-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.caption || '（無文字內容）'}>
                    {s.caption ? s.caption : <span style={{ color: 'var(--ad-text3)' }}>（無文字內容）</span>}
                  </div>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: s.platform === 'FB' ? '#E7F0FF' : '#FCE4EC', color: s.platform === 'FB' ? '#1877F2' : '#C2185B' }}>
                      {s.platform === 'FB' ? 'FB' : 'IG'}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#F3E5F5', color: '#6A1B9A' }}>
                      {isVideo ? '◐ 限動影片' : '◐ 限動圖片'}
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
                    >查看限動 ↗</a>
                  ) : (
                    <span style={{ fontSize: 12.5, color: 'var(--ad-text3)' }}>（已過期）</span>
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
                      title="用 AI 分析此限動"
                      onClick={() => onAskAI(buildStoryPrompt(s), true)}
                      style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                    >✨ 分析</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)' }}>
        共 {stories.length} 則限動 · 略過率為導航行為近似值，非逐秒完播率
      </div>
    </div>
  )
}
