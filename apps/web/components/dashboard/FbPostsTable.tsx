'use client'

import { useState } from 'react'

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

export function FbPostsTable({ posts }: { posts: FbPost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('createdTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!posts.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>尚無 FB 貼文資料</p>
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
            <SortTh k="createdTime" label="日期" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>內容</th>
            <SortTh k="reactions" label="按讚" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label="留言" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label="分享" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
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
                    {post.message || '（無文字內容）'}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.message || '（無文字內容）'}
                  </span>
                )}
                <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, marginTop: 3, background: 'var(--ad-surface2)', color: 'var(--ad-text3)' }}>
                  📝 貼文
                </span>
              </td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.reactions)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.comments)}</td>
              <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.shares)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)' }}>
        共 {posts.length} 筆記錄
      </div>
    </div>
  )
}
