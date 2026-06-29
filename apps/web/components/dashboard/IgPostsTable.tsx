'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { TablePager } from './TablePager'

const PAGE_SIZE = 200

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
  hasAd?: boolean
  adSpend?: number
  adRoas?: number
  adCtr?: number
}

type SortKey = 'timestamp' | 'reach' | 'likes' | 'comments' | 'saved' | 'shares' | 'views'

const mediaLabel = (t: string, en: boolean): string => en
  ? ({ IMAGE: 'Image', VIDEO: 'Video', CAROUSEL_ALBUM: 'Carousel', REELS: 'Reels' }[t] ?? t)
  : ({ IMAGE: '圖片', VIDEO: '影片', CAROUSEL_ALBUM: '輪播', REELS: 'Reels' }[t] ?? t)

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

function buildIgPrompt(post: IgPost, en: boolean): string {
  if (en) return `Please analyze this Instagram post:\nDate: ${post.timestamp.slice(0, 10)} | Type: ${mediaLabel(post.mediaType, true)}\nContent: ${(post.caption || '(no text)').slice(0, 100)}\nReach: ${post.insights.reach} | Likes: ${post.insights.likes} | Comments: ${post.insights.comments} | Saves: ${post.insights.saved} | Shares: ${post.insights.shares} | Plays: ${post.insights.views}\n\nPlease give a performance diagnosis and specific optimization suggestions.`
  return `請分析這篇 Instagram 貼文：\n日期：${post.timestamp.slice(0, 10)}｜類型：${mediaLabel(post.mediaType, false)}\n內容：${(post.caption || '（無文字內容）').slice(0, 100)}\n觸及：${post.insights.reach}｜按讚：${post.insights.likes}｜留言：${post.insights.comments}｜收藏：${post.insights.saved}｜分享：${post.insights.shares}｜播放：${post.insights.views}\n\n請給出成效診斷和具體優化建議。`
}

export function IgPostsTable({ posts, onAskAI }: { posts: IgPost[]; onAskAI?: (q: string, autoSend?: boolean) => void }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [posts, sortKey, sortDir])

  if (!posts.length) {
    return <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--ad-text3)' }}>{L('尚無 IG 貼文資料', 'No IG post data yet')}</p>
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

  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ads-posts-table">
        <thead>
          <tr>
            <SortTh k="timestamp" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'left' }}>{L('類型', 'Type')}</th>
            <th style={{ textAlign: 'left' }}>{L('內容', 'Content')}</th>
            <SortTh k="reach" label={L('觸及', 'Reach')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="likes" label={L('按讚', 'Likes')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="comments" label={L('留言', 'Comments')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="saved" label={L('收藏', 'Saves')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="shares" label={L('分享', 'Shares')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh k="views" label={L('播放', 'Plays')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th style={{ textAlign: 'right', color: 'var(--ad-text3)', fontSize: 11 }}>{L('花費', 'Spend')}</th>
            <th style={{ textAlign: 'right', color: 'var(--ad-text3)', fontSize: 11 }}>CPL</th>
            <th style={{ textAlign: 'right', color: 'var(--ad-text3)', fontSize: 11 }}>CTR</th>
            {onAskAI && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {paged.map(post => {
            const isReels = post.mediaType === 'REELS' || post.mediaType === 'VIDEO'
            return (
              <tr key={post.id}>
                <td className="ads-posts-date">{fullDate(post.timestamp)}</td>
                <td>
                  <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: isReels ? '#FFF3E0' : 'var(--ad-surface2)', color: isReels ? '#E65100' : 'var(--ad-text3)', whiteSpace: 'nowrap' }}>
                    {isReels ? '▶ Reels' : mediaLabel(post.mediaType, en)}
                  </span>
                </td>
                <td style={{ maxWidth: 260 }}>
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {post.caption || L('（無文字內容）', '(no text)')}
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
                <td className="ads-posts-num" style={{ textAlign: 'right', color: post.hasAd ? 'var(--ad-text)' : 'var(--ad-text3)' }}>
                  {post.hasAd && post.adSpend != null && post.adSpend > 0 ? `$${post.adSpend.toLocaleString('zh-TW')}` : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right', fontWeight: post.hasAd && (post.adRoas ?? 0) > 0 ? 600 : undefined, color: post.hasAd && (post.adRoas ?? 0) >= 2 ? 'var(--ad-green)' : undefined }}>
                  {post.hasAd && post.adRoas != null && post.adRoas > 0 ? `${post.adRoas.toFixed(1)}x` : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
                <td className="ads-posts-num" style={{ textAlign: 'right' }}>
                  {post.hasAd && post.adCtr != null && post.adCtr > 0 ? `${post.adCtr.toFixed(2)}%` : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                </td>
                {onAskAI && (
                  <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                    <button
                      title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                      onClick={() => onAskAI(buildIgPrompt(post, en), true)}
                      style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                    >✨ {L('分析', 'Analyze')}</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <TablePager page={page} pageSize={PAGE_SIZE} total={sorted.length} onPage={setPage} />
    </div>
  )
}
