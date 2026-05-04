'use client'

import { useState, useMemo } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

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
  likes: number     // fb.reactions + ig.likes
  comments: number  // fb.comments + ig.comments
  saved: number
  shares: number    // fb.shares + ig.shares
  views: number
}

type SortKey = keyof Omit<CombinedRow, 'date' | 'content' | 'permalink' | 'fbOnly' | 'igOnly'>

function fmt(n: number) {
  return n.toLocaleString()
}

function fullDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>
  return <span className="ml-1">{dir === 'desc' ? '↓' : '↑'}</span>
}

function platformBadge(row: CombinedRow) {
  if (row.fbOnly) return <span className="text-[10px] text-blue-400 ml-1">FB only</span>
  if (row.igOnly) return <span className="text-[10px] text-pink-400 ml-1">IG only</span>
  return null
}

export function CombinedPostsTable({ fbPosts, igPosts }: { fbPosts: FbPost[]; igPosts: IgPost[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo<CombinedRow[]>(() => {
    const byDate = new Map<string, { fb?: FbPost; ig?: IgPost }>()

    for (const fb of fbPosts) {
      const d = fb.createdTime.slice(0, 10)
      const entry = byDate.get(d) ?? {}
      // keep only the first fb post per date
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
    return <p className="py-8 text-center text-sm text-gray-400">尚無整合貼文資料</p>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === 'date' ? new Date(a.date).getTime() : a[sortKey] as number
    const bv = sortKey === 'date' ? new Date(b.date).getTime() : b[sortKey] as number
    return sortDir === 'desc' ? bv - av : av - bv
  })

  // totals row
  const totals = rows.reduce(
    (acc, r) => ({
      reach: acc.reach + r.reach,
      likes: acc.likes + r.likes,
      comments: acc.comments + r.comments,
      saved: acc.saved + r.saved,
      shares: acc.shares + r.shares,
      views: acc.views + r.views,
    }),
    { reach: 0, likes: 0, comments: 0, saved: 0, shares: 0, views: 0 }
  )

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
              onClick={() => handleSort('date')}
            >
              日期
              <SortIcon active={sortKey === 'date'} dir={sortDir} />
            </TableHead>
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
          {sorted.map((row) => (
            <TableRow key={row.date} className="text-sm">
              <TableCell className="text-gray-400 whitespace-nowrap">
                {fullDate(row.date)}
                {platformBadge(row)}
              </TableCell>
              <TableCell className="max-w-[240px]">
                <a
                  href={row.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-gray-700 hover:text-purple-600"
                >
                  {row.content}
                </a>
              </TableCell>
              <TableCell className="text-right font-medium">{row.igOnly || (!row.fbOnly) ? fmt(row.reach) : '—'}</TableCell>
              <TableCell className="text-right">{fmt(row.likes)}</TableCell>
              <TableCell className="text-right">{fmt(row.comments)}</TableCell>
              <TableCell className="text-right">{row.igOnly || (!row.fbOnly) ? fmt(row.saved) : '—'}</TableCell>
              <TableCell className="text-right">{fmt(row.shares)}</TableCell>
              <TableCell className="text-right">
                {row.views > 0 ? fmt(row.views) : '—'}
              </TableCell>
            </TableRow>
          ))}
          {/* totals row */}
          <TableRow className="bg-gray-50 text-sm font-semibold border-t-2">
            <TableCell className="text-gray-500">合計</TableCell>
            <TableCell />
            <TableCell className="text-right">{fmt(totals.reach)}</TableCell>
            <TableCell className="text-right">{fmt(totals.likes)}</TableCell>
            <TableCell className="text-right">{fmt(totals.comments)}</TableCell>
            <TableCell className="text-right">{fmt(totals.saved)}</TableCell>
            <TableCell className="text-right">{fmt(totals.shares)}</TableCell>
            <TableCell className="text-right">{totals.views > 0 ? fmt(totals.views) : '—'}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
