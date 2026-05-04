'use client'

import { useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

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

const MEDIA_TYPE_LABEL: Record<IgPost['mediaType'], string> = {
  IMAGE: '圖片',
  VIDEO: '影片',
  CAROUSEL_ALBUM: '輪播',
  REELS: 'Reels',
}

function fmt(n: number) {
  return n.toLocaleString()
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>
  return <span className="ml-1">{dir === 'desc' ? '↓' : '↑'}</span>
}

export function IgPostsTable({ posts }: { posts: IgPost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!posts.length) {
    return <p className="py-8 text-center text-sm text-gray-400">尚無 IG 貼文資料</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
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

  const col = (key: SortKey, label: string) => (
    <TableHead
      className="text-right cursor-pointer select-none hover:text-gray-700"
      onClick={() => handleSort(key)}
    >
      {label}
      <SortIcon active={sortKey === key} dir={sortDir} />
    </TableHead>
  )

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 text-xs">
            <TableHead
              className="w-[110px] cursor-pointer select-none hover:text-gray-700"
              onClick={() => handleSort('timestamp')}
            >
              日期
              <SortIcon active={sortKey === 'timestamp'} dir={sortDir} />
            </TableHead>
            <TableHead className="w-[80px]">類型</TableHead>
            <TableHead className="max-w-[240px]">內容</TableHead>
            {col('reach', '觸及')}
            {col('likes', '按讚')}
            {col('comments', '留言')}
            {col('saved', '收藏')}
            {col('shares', '分享')}
            {col('views', '播放')}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((post) => (
            <TableRow key={post.id} className="text-sm">
              <TableCell className="text-gray-400 whitespace-nowrap">
                {fullDate(post.timestamp)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs">
                  {MEDIA_TYPE_LABEL[post.mediaType] ?? post.mediaType}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[240px]">
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-gray-700 hover:text-pink-600"
                >
                  {post.caption || '（無文字內容）'}
                </a>
              </TableCell>
              <TableCell className="text-right font-medium">{fmt(post.insights.reach)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.likes)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.comments)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.saved)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.shares)}</TableCell>
              <TableCell className="text-right">
                {post.insights.views > 0 ? fmt(post.insights.views) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
