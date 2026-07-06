'use client'

import { useEffect, useState, useMemo } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { TablePager } from './TablePager'

const PAGE_SIZE = 200

export interface ThreadsPost {
  id: string
  text: string
  mediaType: string
  permalink: string
  timestamp: string
  insights: { views: number; reach: number; likes: number; comments: number; shares: number }
}

type SortKey = 'date' | 'views' | 'likes' | 'comments' | 'shares'

const fmt = (n: number) => n.toLocaleString('zh-TW')

function fullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function buildPostPrompt(p: ThreadsPost, en: boolean): string {
  const i = p.insights
  const engRate = i.views > 0 ? ((i.likes + i.comments + i.shares) / i.views * 100).toFixed(2) : '0.00'
  if (en) return `Please analyze this Threads post:\nDate: ${p.timestamp.slice(0, 10)}\nContent: ${p.text.slice(0, 100)}\nViews: ${fmt(i.views)} | Likes: ${i.likes} | Replies: ${i.comments} | Reposts+Quotes: ${i.shares}\nEngagement: ${engRate}%\n\nPlease give a performance diagnosis and specific optimization suggestions.`
  return `請分析這篇 Threads 貼文：\n日期：${p.timestamp.slice(0, 10)}\n內容：${p.text.slice(0, 100)}\n觀看：${fmt(i.views)}｜按讚：${i.likes}｜留言：${i.comments}｜轉發：${i.shares}\n互動率：${engRate}%\n\n請給出這篇貼文的成效診斷和具體優化建議。`
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

export function ThreadsPostsTable({ posts, onAskAI }: { posts: ThreadsPost[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [posts, sortKey, sortDir])

  const sorted = useMemo(() => {
    return [...posts].sort((a, b) => {
      const av = sortKey === 'date' ? new Date(a.timestamp).getTime() : (a.insights[sortKey] as number)
      const bv = sortKey === 'date' ? new Date(b.timestamp).getTime() : (b.insights[sortKey] as number)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [posts, sortKey, sortDir])

  if (!posts.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>{L('尚無 Threads 貼文資料', 'No Threads post data yet')}</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totals = posts.reduce(
    (acc, p) => ({ views: acc.views + p.insights.views, likes: acc.likes + p.insights.likes, comments: acc.comments + p.insights.comments, shares: acc.shares + p.insights.shares }),
    { views: 0, likes: 0, comments: 0, shares: 0 }
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ads-posts-table">
        <thead>
          <tr>
            <SortTh k="date" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>{L('內容', 'Content')}</th>
            <SortTh k="views" label={L('觀看', 'Views')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="likes" label={L('按讚', 'Likes')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label={L('留言', 'Replies')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label={L('轉發', 'Reposts')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {paged.map(p => (
            <tr key={p.id}>
              <td className="ads-posts-date" style={{ whiteSpace: 'nowrap' }}>
                {fullDate(p.timestamp)}
                <span className="ads-posts-platform-badge" style={{ marginLeft: 6, background: '#0a0a0a', color: '#fff' }}>TH</span>
              </td>
              <td style={{ maxWidth: 260 }}>
                {p.permalink ? (
                  <a href={p.permalink} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                    {p.text || (en ? '(no text)' : '（無文字內容）')}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.text || (en ? '(no text)' : '（無文字內容）')}
                  </span>
                )}
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: 600, color: p.insights.views > 200 ? 'var(--ad-green)' : undefined }}>
                {p.insights.views > 0 ? fmt(p.insights.views) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.insights.likes)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.insights.comments)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.insights.shares)}</td>
              {onAskAI && (
                <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                  <button title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                    onClick={() => onAskAI(buildPostPrompt(p, en), true)}
                    style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                  >✨ {L('分析', 'Analyze')}</button>
                </td>
              )}
            </tr>
          ))}
          <tr style={{ background: 'var(--ad-surface2)', fontWeight: 600, borderTop: '2px solid var(--ad-border)' }}>
            <td className="ads-posts-date">{L('合計', 'Total')}</td>
            <td />
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.views)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.likes)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.comments)}</td>
            <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(totals.shares)}</td>
            {onAskAI && <td />}
          </tr>
        </tbody>
      </table>
      <TablePager page={page} pageSize={PAGE_SIZE} total={posts.length} onPage={setPage} />
    </div>
  )
}
