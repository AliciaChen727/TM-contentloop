'use client'

import { useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

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

export function FbPostsTable({ posts }: { posts: FbPost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('createdTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!posts.length) {
    return <p className="py-8 text-center text-sm text-gray-400">尚無 FB 貼文資料</p>
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
    if (sortKey === 'createdTime') {
      av = new Date(a.createdTime).getTime()
      bv = new Date(b.createdTime).getTime()
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
              onClick={() => handleSort('createdTime')}
            >
              日期
              <SortIcon active={sortKey === 'createdTime'} dir={sortDir} />
            </TableHead>
            <TableHead className="max-w-[260px]">內容</TableHead>
            {col('reactions', '按讚')}
            {col('comments', '留言')}
            {col('shares', '分享')}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((post) => (
            <TableRow key={post.id} className="text-sm">
              <TableCell className="text-gray-400 whitespace-nowrap">
                {fullDate(post.createdTime)}
              </TableCell>
              <TableCell className="max-w-[260px]">
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-gray-700 hover:text-blue-600"
                >
                  {post.message || '（無文字內容）'}
                </a>
              </TableCell>
              <TableCell className="text-right">{fmt(post.insights.reactions)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.comments)}</TableCell>
              <TableCell className="text-right">{fmt(post.insights.shares)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
