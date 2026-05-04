'use client'

import { useState } from 'react'

interface IgPost {
  id: string
  caption: string
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS'
  permalink: string
  timestamp: string
  insights: {
    reach: number
    likes: number
    comments: number
    saved: number
    shares: number
    views: number
  }
}

type SortKey = 'timestamp' | 'reach' | 'likes' | 'comments' | 'saved' | 'shares' | 'views'

const MEDIA_LABEL: Record<IgPost['mediaType'], string> = {
  IMAGE: '圖片', VIDEO: '影片', CAROUSEL_ALBUM: '輪播', REELS: 'Reels',
}

const fmt = (n: number) => n.toLocaleString('zh-TW')

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', {
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

export function IgPostsTable({ posts }: { posts: IgPost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!posts.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>尚無 IG 貼文資料</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...posts].sort((a, b) => {
    let av: number, bv: number
    if (sortKey === 'timestamp') {
      av = new Date(a.timestamp).getTime()
      bv = new Date(b.timestamp).getTime()
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
            <th style={{ textAlign: 'left' }}>類型</th>
            <th style={{ textAlign: 'left' }}>內容</th>
            <SortTh k="reach" label="觸及" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="likes" label="按讚" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label="留言" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="saved" label="收藏" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label="分享" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="views" label="播放" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map(post => {
            const isReels = post.mediaType === 'REELS' || post.mediaType === 'VIDEO'
            return (
              <tr key={post.id}>
                <td className="ads-posts-date">{fullDate(post.timestamp)}</td>
                <td>
                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: isReels ? '#FFF3E0' : 'var(--ad-surface2)', color: isReels ? '#E65100' : 'var(--ad-text3)', whiteSpace: 'nowrap' }}>
                    {isReels ? '▶ Reels' : MEDIA_LABEL[post.mediaType] ?? post.mediaType}
                  </span>
                </td>
                <td style={{ maxWidth: 260 }}>
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {post.caption || '（無文字內容）'}
                  </a>
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: 600, color: post.insights.reach > 200 ? 'var(--ad-green)' : undefined }}>
                  {fmt(post.insights.reach)}
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.likes)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.comments)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.saved)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(post.insights.shares)}</td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>
                  {post.insights.views > 0 ? fmt(post.insights.views) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)' }}>
        共 {posts.length} 筆記錄
      </div>
    </div>
  )
}
