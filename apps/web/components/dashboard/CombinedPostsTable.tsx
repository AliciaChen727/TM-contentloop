'use client'

import { useEffect, useState, useMemo } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { TablePager } from './TablePager'

const PAGE_SIZE = 200

interface FbPost {
  id: string
  message: string
  createdTime: string
  permalink: string
  insights: { reactions: number; comments: number; shares: number; reach: number }
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

function buildPostPrompt(row: CombinedRow, en: boolean): string {
  const platform = row.fbOnly ? 'Facebook' : row.igOnly ? 'Instagram' : 'FB+IG'
  const engRate = row.reach > 0 ? ((row.likes + row.comments + row.shares) / row.reach * 100).toFixed(2) : '0.00'
  if (en) return `Please analyze this post:\nDate: ${row.date} | Platform: ${platform}\nContent: ${row.content.slice(0, 100)}\nReach: ${fmt(row.reach)} | Likes: ${row.likes} | Comments: ${row.comments} | Saves: ${row.saved} | Shares: ${row.shares} | Plays: ${row.views}\nEngagement: ${engRate}%\n\nPlease give a performance diagnosis and specific optimization suggestions.`
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
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

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
      content: ig?.caption || fb?.message || (en ? '(no text)' : '（無文字內容）'),
      permalink: ig?.permalink || fb?.permalink || '',
      fbOnly: !!fb && !ig,
      igOnly: !fb && !!ig,
      reach: (fb?.insights.reach ?? 0) + (ig?.insights.reach ?? 0),
      likes: (fb?.insights.reactions ?? 0) + (ig?.insights.likes ?? 0),
      comments: (fb?.insights.comments ?? 0) + (ig?.insights.comments ?? 0),
      saved: ig?.insights.saved ?? 0,
      shares: (fb?.insights.shares ?? 0) + (ig?.insights.shares ?? 0),
      views: ig?.insights.views ?? 0,
    }))
  }, [fbPosts, igPosts])

  // Reset to first page when the data set or sort changes.
  useEffect(() => { setPage(1) }, [rows, sortKey, sortDir])

  if (!rows.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>{L('尚無整合貼文資料', 'No combined post data yet')}</p>
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

  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
            <SortTh k="date" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>{L('內容', 'Content')}</th>
            <SortTh k="reach" label={L('觸及', 'Reach')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="likes" label={L('按讚', 'Likes')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label={L('留言', 'Comments')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="saved" label={L('收藏', 'Saves')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label={L('分享', 'Shares')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="views" label={L('播放', 'Plays')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {paged.map(row => (
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
                {row.reach > 0 ? fmt(row.reach) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
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
                    title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                    onClick={() => onAskAI(buildPostPrompt(row, en), true)}
                    style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                  >✨ {L('分析', 'Analyze')}</button>
                </td>
              )}
            </tr>
          ))}
          <tr style={{ background: 'var(--ad-surface2)', fontWeight: 600, borderTop: '2px solid var(--ad-border)' }}>
            <td className="ads-posts-date">{L('合計', 'Total')}</td>
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
      <TablePager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
    </div>
  )
}
