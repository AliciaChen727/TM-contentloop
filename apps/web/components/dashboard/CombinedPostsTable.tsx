'use client'

import { useState, useMemo } from 'react'

interface FbPost {
  id: string
  message: string
  createdTime: string
  permalink: string
  insights: { reactions: number; comments: number; shares: number }
}

interface IgPost {
  id: string
  caption: string
  mediaType: string
  permalink: string
  timestamp: string
  insights: { reach: number; likes: number; comments: number; saved: number; shares: number; views: number }
}

interface CombinedRow {
  date: string
  content: string
  permalink: string
  fbOnly: boolean
  igOnly: boolean
  reach: number
  likes: number
  comments: number
  saved: number
  shares: number
  views: number
}

type SortKey = 'date' | 'reach' | 'likes' | 'comments' | 'saved' | 'shares' | 'views'

const fmt = (n: number) => n.toLocaleString('zh-TW')

function buildPostPrompt(row: CombinedRow): string {
  const platform = row.fbOnly ? 'Facebook' : row.igOnly ? 'Instagram' : 'FB+IG'
  const engRate = row.reach > 0 ? ((row.likes + row.comments + row.shares) / row.reach * 100).toFixed(2) : '0.00'
  return `請分析這篇貼文：\n日期：${row.date}｜平台：${platform}\n內容：${row.content.slice(0, 100)}\n觸及：${fmt(row.reach)}｜按讚：${row.likes}｜留言：${row.comments}｜收藏：${row.saved}｜分享：${row.shares}｜播放：${row.views}\n互動率：${engRate}%\n\n請給出這篇貼文的成效診斷和具體優化建議。`
}

function fullDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function SortTh({ k, label, sortKey, sortDir, onSort }: {
  k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
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

function PlatBadge({ row }: { row: CombinedRow }) {
  if (row.fbOnly) return <span className="ads-posts-platform-badge fb" style={{ marginLeft: 6 }}>FB</span>
  if (row.igOnly) return <span className="ads-posts-platform-badge ig" style={{ marginLeft: 6 }}>IG</span>
  return <span className="ads-posts-platform-badge both" style={{ marginLeft: 6 }}>FB+IG</span>
}

export function CombinedPostsTable({ fbPosts, igPosts, onAskAI }: { fbPosts: FbPost[]; igPosts: IgPost[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo<CombinedRow[]>(() => {
    const byDate = new Map<string, { fb?: FbPost; ig?: IgPost }>()
    for (const fb of fbPosts) {
      const d = fb.createdTime.slice(0, 10)
      const entry = byDate.get(d) ?? {}
      if (!entry.fb) byDate.set(d, { ...entry, fb })
    }
    for (const ig of igPosts) {
      const d = ig.timestamp.slice(0, 10)
      const entry = byDate.get(d) ?? {}
      if (!entry.ig) byDate.set(d, { ...entry, ig })
    }
    return Array.from(byDate.entries()).map(([date, { fb, ig }]) => ({
      date,
      content: ig?.caption || fb?.message || '（無文字內容）',
      permalink: ig?.permalink || fb?.permalink || '',
      fbOnly: !!fb && !ig,
      igOnly: !fb && !!ig,
      reach: ig?.insights.reach ?? 0,
      likes: (fb?.insights.reactions ?? 0) + (ig?.insights.likes ?? 0),
      comments: (fb?.insights.comments ?? 0) + (ig?.insights.comments ?? 0),
      saved: ig?.insights.saved ?? 0,
      shares: (fb?.insights.shares ?? 0) + (ig?.insights.shares ?? 0),
      views: ig?.insights.views ?? 0,
    }))
  }, [fbPosts, igPosts])

  if (!rows.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>尚無整合貼文資料</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === 'date' ? new Date(a.date).getTime() : a[sortKey] as number
    const bv = sortKey === 'date' ? new Date(b.date).getTime() : b[sortKey] as number
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const totals = rows.reduce(
    (acc, r) => ({
      reach: acc.reach + r.reach, likes: acc.likes + r.likes,
      comments: acc.comments + r.comments, saved: acc.saved + r.saved,
      shares: acc.shares + r.shares, views: acc.views + r.views,
    }),
    { reach: 0, likes: 0, comments: 0, saved: 0, shares: 0, views: 0 }
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ads-posts-table">
        <thead>
          <tr>
            <SortTh k="date" label="日期" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>內容</th>
            <SortTh k="reach" label="觸及" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="likes" label="按讚" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label="留言" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="saved" label="收藏" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label="分享" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="views" label="播放" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.date}>
              <td className="ads-posts-date" style={{ whiteSpace: 'nowrap' }}>
                {fullDate(row.date)}
                <PlatBadge row={row} />
              </td>
              <td style={{ maxWidth: 260 }}>
                {row.permalink ? (
                  <a
                    href={row.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {row.content}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.content}
                  </span>
                )}
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: 600, color: row.reach > 200 ? 'var(--ad-green)' : undefined }}>
                {row.igOnly || !row.fbOnly ? fmt(row.reach) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(row.likes)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(row.comments)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>
                {row.igOnly || !row.fbOnly ? fmt(row.saved) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(row.shares)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>
                {row.views > 0 ? fmt(row.views) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
              </td>
              {onAskAI && (
                <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                  <button
                    title="用 AI 分析此貼文"
                    onClick={() => onAskAI(buildPostPrompt(row), true)}
                    style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                  >✨ 分析</button>
                </td>
              )}
            </tr>
          ))}
          <tr style={{ background: 'var(--ad-surface2)', fontWeight: 600, borderTop: '2px solid var(--ad-border)' }}>
            <td className="ads-posts-date">合計</td>
            <td />
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.reach)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.likes)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.comments)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.saved)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.shares)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>
              {totals.views > 0 ? fmt(totals.views) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
            </td>
            {onAskAI && <td />}
          </tr>
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>共 {rows.length} 筆記錄</span>
        <span>點擊內容標題可前往原始貼文連結</span>
      </div>
    </div>
  )
}
