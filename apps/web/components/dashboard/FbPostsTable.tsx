'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface FbPost {
  id: string
  message: string
  createdTime: string
  permalink: string
  insights: {
    reactions: number
    comments: number
    shares: number
  }
}

type SortKey = 'createdTime' | 'reactions' | 'comments' | 'shares'

const fmt = (n: number) => n.toLocaleString('zh-TW')

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function SortTh({ k, label, sortKey, sortDir, onSort, className }: {
  k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void; className?: string
}) {
  return (
    <th className={`${sortKey === k ? 'sorted' : ''} ${className ?? ''}`} onClick={() => onSort(k)} style={{ cursor: 'pointer' }}>
      {label}
      <span style={{ marginLeft: 4, opacity: sortKey === k ? 1 : 0.4, fontSize: 10, color: sortKey === k ? 'var(--ad-blue)' : undefined }}>
        {sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </th>
  )
}

function buildFbPrompt(post: FbPost, en: boolean): string {
  if (en) return `Please analyze this Facebook post:\nDate: ${post.createdTime.slice(0, 10)}\nContent: ${(post.message || '(no text)').slice(0, 100)}\nLikes: ${post.insights.reactions} | Comments: ${post.insights.comments} | Shares: ${post.insights.shares}\n\nPlease give a performance diagnosis and specific optimization suggestions.`
  return `請分析這篇 Facebook 貼文：\n日期：${post.createdTime.slice(0, 10)}\n內容：${(post.message || '（無文字內容）').slice(0, 100)}\n按讚：${post.insights.reactions}｜留言：${post.insights.comments}｜分享：${post.insights.shares}\n\n請給出成效診斷和具體優化建議。`
}

export function FbPostsTable({ posts, onAskAI }: { posts: FbPost[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortKey, setSortKey] = useState<SortKey>('createdTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!posts.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>{L('尚無 FB 貼文資料', 'No FB post data yet')}</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...posts].sort((a, b) => {
    let av: number, bv: number
    if (sortKey === 'createdTime') {
      av = new Date(a.createdTime).getTime()
      bv = new Date(b.createdTime).getTime()
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
            <SortTh k="createdTime" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>{L('內容', 'Content')}</th>
            <SortTh k="reactions" label={L('按讚', 'Likes')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label={L('留言', 'Comments')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label={L('分享', 'Shares')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map(post => (
            <tr key={post.id}>
              <td className="ads-posts-date">{fullDate(post.createdTime)}</td>
              <td style={{ maxWidth: 280 }}>
                {post.permalink ? (
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {post.message || L('（無文字內容）', '(no text)')}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.message || L('（無文字內容）', '(no text)')}
                  </span>
                )}
                <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, marginTop: 3, background: 'var(--ad-surface2)', color: 'var(--ad-text3)' }}>
                  📝 {L('貼文', 'Post')}
                </span>
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.reactions)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.comments)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.shares)}</td>
              {onAskAI && (
                <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                  <button
                    title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                    onClick={() => onAskAI(buildFbPrompt(post, en), true)}
                    style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                  >✨ {L('分析', 'Analyze')}</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)' }}>
        {L(`共 ${posts.length} 筆記錄`, `${posts.length} records`)}
      </div>
    </div>
  )
}
