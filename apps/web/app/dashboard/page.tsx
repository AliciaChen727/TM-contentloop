'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'
import { FbPostsTable } from '@/components/dashboard/FbPostsTable'
import { IgPostsTable } from '@/components/dashboard/IgPostsTable'
import { CombinedPostsTable } from '@/components/dashboard/CombinedPostsTable'
import { ContentChart } from '@/components/dashboard/ContentChart'
import type { DailyPoint } from '@/components/dashboard/ContentChart'

interface PageTokenData { pageName: string; pageId: string; igUserId: string | null }

interface FbPost {
  id: string; message: string; createdTime: string; permalink: string
  insights: { reactions: number; comments: number; shares: number }
}
interface IgPost {
  id: string; caption: string; mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS'; permalink: string; timestamp: string
  insights: { reach: number; likes: number; comments: number; saved: number; shares: number; views: number }
}

type Tab = 'fb' | 'ig' | 'combined'

const fmtBig = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('zh-TW')

export default function DashboardPage() {
  const router = useRouter()
  const [pageData, setPageData] = useState<PageTokenData | null>(null)
  const [fbPosts, setFbPosts] = useState<FbPost[]>([])
  const [igPosts, setIgPosts] = useState<IgPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('combined')
  const [typeFilter, setTypeFilter] = useState<'all' | 'post' | 'reels'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }

      const tokenSnap = await getDoc(doc(db, 'users', u.uid, 'metaTokens', 'page'))
      if (tokenSnap.exists()) setPageData(tokenSnap.data() as PageTokenData)

      const idToken = await u.getIdToken()
      const headers = { Authorization: `Bearer ${idToken}` }

      const [fbRes, igRes] = await Promise.all([
        fetch('/api/insights/fb', { headers }),
        fetch('/api/insights/ig', { headers }),
      ])

      if (fbRes.ok) { const d = await fbRes.json(); setFbPosts(d.posts ?? []) }
      if (igRes.ok) { const d = await igRes.json(); setIgPosts(d.posts ?? []) }
      setLoading(false)
    })
    return unsub
  }, [router])

  // Filtered posts for table
  const filteredFb = useMemo(() => {
    let arr = fbPosts
    if (typeFilter === 'reels') return []
    if (search) arr = arr.filter(p => p.message.toLowerCase().includes(search.toLowerCase()))
    return arr
  }, [fbPosts, typeFilter, search])

  const filteredIg = useMemo(() => {
    let arr = igPosts
    if (typeFilter === 'post') arr = arr.filter(p => p.mediaType !== 'REELS' && p.mediaType !== 'VIDEO')
    if (typeFilter === 'reels') arr = arr.filter(p => p.mediaType === 'REELS' || p.mediaType === 'VIDEO')
    if (search) arr = arr.filter(p => p.caption.toLowerCase().includes(search.toLowerCase()))
    return arr
  }, [igPosts, typeFilter, search])

  // Daily aggregated data for chart
  const dailyData = useMemo<DailyPoint[]>(() => {
    const byDate = new Map<string, { reach: number; likes: number; comments: number; shares: number }>()
    for (const fb of fbPosts) {
      const d = fb.createdTime.slice(0, 10)
      const e = byDate.get(d) ?? { reach: 0, likes: 0, comments: 0, shares: 0 }
      byDate.set(d, { ...e, likes: e.likes + (fb.insights?.reactions ?? 0), comments: e.comments + (fb.insights?.comments ?? 0), shares: e.shares + (fb.insights?.shares ?? 0) })
    }
    for (const ig of igPosts) {
      const d = ig.timestamp.slice(0, 10)
      const e = byDate.get(d) ?? { reach: 0, likes: 0, comments: 0, shares: 0 }
      byDate.set(d, { ...e, reach: e.reach + (ig.insights?.reach ?? 0), likes: e.likes + (ig.insights?.likes ?? 0), comments: e.comments + (ig.insights?.comments ?? 0), shares: e.shares + (ig.insights?.shares ?? 0) })
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fullDate, d]) => ({
        date: fullDate.slice(5).replace('-', '/'),
        fullDate,
        reach: d.reach,
        likes: d.likes,
        comments: d.comments,
        shares: d.shares,
        engRate: d.reach > 0 ? Number(((d.likes + d.comments + d.shares) / d.reach * 100).toFixed(2)) : 0,
      }))
  }, [fbPosts, igPosts])

  // Summary stats
  const stats = useMemo(() => {
    const totalReach = igPosts.reduce((s, p) => s + (p.insights?.reach ?? 0), 0)
    const totalLikes = fbPosts.reduce((s, p) => s + (p.insights?.reactions ?? 0), 0) + igPosts.reduce((s, p) => s + (p.insights?.likes ?? 0), 0)
    const totalComments = fbPosts.reduce((s, p) => s + (p.insights?.comments ?? 0), 0) + igPosts.reduce((s, p) => s + (p.insights?.comments ?? 0), 0)
    const totalShares = fbPosts.reduce((s, p) => s + (p.insights?.shares ?? 0), 0) + igPosts.reduce((s, p) => s + (p.insights?.shares ?? 0), 0)
    const avgEngRate = totalReach > 0 ? ((totalLikes + totalComments + totalShares) / totalReach * 100) : 0
    const reelsCount = igPosts.filter(p => p.mediaType === 'REELS' || p.mediaType === 'VIDEO').length
    return { totalReach, totalLikes, totalComments, totalShares, avgEngRate, totalPosts: fbPosts.length + igPosts.length, reelsCount }
  }, [fbPosts, igPosts])

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/auth/login')
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">載入中⋯⋯</p>
      </main>
    )
  }

  const tabClass = (t: Tab) =>
    `flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${activeTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">ContentLoop</h1>
            {pageData && <p className="text-xs text-gray-400">{pageData.pageName}</p>}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/dashboard/ads')}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors"
            >
              📊 廣告儀表板
            </button>
            <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-gray-600">登出</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-8 py-6">
        {!pageData ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-4 text-sm text-gray-500">尚未連接 Facebook 粉專</p>
            <button
              onClick={() => router.push('/auth/connect')}
              className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166FE5]"
            >
              連接 Facebook
            </button>
          </div>
        ) : (
          <>
            {/* Summary Strip */}
            <div className="ads-posts-summary-strip" style={{ marginBottom: 20 }}>
              {[
                { label: '總貼文數', value: stats.totalPosts, sub: `${stats.reelsCount} Reels · ${stats.totalPosts - stats.reelsCount} 貼文` },
                { label: '總觸擊 (IG)', value: fmtBig(stats.totalReach), sub: '來自 IG 貼文' },
                { label: '總按讚', value: fmtBig(stats.totalLikes), sub: `留言 ${stats.totalComments} · 分享 ${stats.totalShares}` },
                { label: '平均互動率', value: `${stats.avgEngRate.toFixed(2)}%`, sub: '(按讚+留言+分享)/觸及' },
              ].map(s => (
                <div key={s.label} className="ads-posts-sum-card">
                  <div className="ads-posts-sum-label">{s.label}</div>
                  <div className="ads-posts-sum-value">{s.value}</div>
                  <div className="ads-posts-sum-sub">{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Chart Card */}
            <div className="ads-card ads-card-pad" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ad-text)' }}>成效趨勢</span>
                <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>每日凌晨 3 點自動更新</span>
              </div>
              <ContentChart data={dailyData} />
            </div>

            {/* Tab + Filter toolbar */}
            <div className="ads-posts-toolbar" style={{ marginBottom: 12 }}>
              <div className="ads-posts-platform-tabs">
                <button onClick={() => setActiveTab('combined')} className={`ads-posts-platform-tab ${activeTab === 'combined' ? 'active' : ''}`}>FB + IG</button>
                <button onClick={() => setActiveTab('fb')} className={`ads-posts-platform-tab ${activeTab === 'fb' ? 'active' : ''}`}>
                  Facebook <span className="badge">{fbPosts.length}</span>
                </button>
                <button onClick={() => setActiveTab('ig')} className={`ads-posts-platform-tab ${activeTab === 'ig' ? 'active' : ''}`}>
                  Instagram <span className="badge">{igPosts.length}</span>
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'post', 'reels'] as const).map(v => (
                  <button key={v} className={`ads-posts-type-chip ${typeFilter === v ? 'active' : ''}`} onClick={() => setTypeFilter(v)}>
                    {v === 'all' ? '全部' : v === 'post' ? '貼文' : 'Reels'}
                  </button>
                ))}
              </div>
              <input className="ads-posts-search" placeholder="搜尋貼文內容…" value={search} onChange={e => setSearch(e.target.value)} />
              <p style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ad-text3)' }}>點擊欄位標題可排序</p>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm">
              {activeTab === 'combined' && <CombinedPostsTable fbPosts={filteredFb} igPosts={filteredIg} />}
              {activeTab === 'fb' && <FbPostsTable posts={filteredFb} />}
              {activeTab === 'ig' && <IgPostsTable posts={filteredIg} />}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
