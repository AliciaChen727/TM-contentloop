'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'
import { FbPostsTable } from '@/components/dashboard/FbPostsTable'
import { FbCsvImport } from '@/components/dashboard/FbCsvImport'
import { FbMdImport } from '@/components/dashboard/FbMdImport'
import { IgPostsTable } from '@/components/dashboard/IgPostsTable'
import { CombinedPostsTable } from '@/components/dashboard/CombinedPostsTable'
import { ContentChart } from '@/components/dashboard/ContentChart'
import type { DailyPoint } from '@/components/dashboard/ContentChart'
import { AiSidekick } from '@/components/ads/AiSidekick'
import type { MetricsContext } from '@/components/ads/AiSidekick'
import { ProfileMenu } from '@/components/ProfileMenu'

interface Permissions { ads: boolean; sidekick: boolean; syncAds: boolean }
interface PageInfo { pageId: string; pageName: string; igUserId: string | null; permissions?: Permissions | null }
interface PageTokenData { pageName: string; pageId: string; igUserId: string | null }

interface FbPost {
  id: string; message: string; createdTime: string; permalink: string
  insights: { reactions: number; comments: number; shares: number; reach: number }
}
interface IgPost {
  id: string; caption: string; mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS'; permalink: string; timestamp: string
  insights: { reach: number; likes: number; comments: number; saved: number; shares: number; views: number }
}

type Tab = 'fb' | 'ig' | 'combined'

const fmtBig = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('zh-TW')

const DATE_OPTS = [
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
  { label: '全部', days: 0 },
]

const dateBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: active ? '1px solid var(--ad-blue)' : '1px solid var(--ad-border)',
  background: active ? 'var(--ad-blue-light)' : 'var(--ad-surface)',
  color: active ? 'var(--ad-blue)' : 'var(--ad-text2)',
  transition: 'all 0.12s',
})

const dateInputStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 6, border: '1px solid var(--ad-border)',
  fontSize: 12, color: 'var(--ad-text2)', background: 'var(--ad-surface)', outline: 'none',
}

export default function DashboardPage() {
  const router = useRouter()
  const [pageData, setPageData] = useState<PageTokenData | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [fbPosts, setFbPosts] = useState<FbPost[]>([])
  const [igPosts, setIgPosts] = useState<IgPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('combined')
  const [typeFilter, setTypeFilter] = useState<'all' | 'post' | 'reels'>('all')
  const [search, setSearch] = useState('')
  // Date range (shared between summary + chart)
  const [days, setDays] = useState(30)
  const [dateMode, setDateMode] = useState<'preset' | 'custom'>('preset')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [addingPage, setAddingPage] = useState(false)
  const [addPageInput, setAddPageInput] = useState('')
  const [addPageError, setAddPageError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [userName, setUserName] = useState('')

  const fetchPosts = useCallback(async (idToken: string, pageId: string) => {
    const headers = { Authorization: `Bearer ${idToken}` }
    const qs = pageId ? `?pageId=${pageId}` : ''
    const [fbRes, igRes] = await Promise.all([
      fetch(`/api/insights/fb${qs}`, { headers }),
      fetch(`/api/insights/ig${qs}`, { headers }),
    ])
    if (fbRes.ok) { const d = await fbRes.json(); setFbPosts((d.posts ?? []).filter((p: FbPost) => p.message?.trim())) }
    if (igRes.ok) { const d = await igRes.json(); setIgPosts(d.posts ?? []) }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const idToken = await u.getIdToken()
      const headers = { Authorization: `Bearer ${idToken}` }

      // Fetch pages list from API
      const pagesRes = await fetch('/api/pages', { headers })
      let pageList: PageInfo[] = []
      if (pagesRes.ok) {
        const d = await pagesRes.json()
        pageList = d.pages ?? []
        setPages(pageList)
        setIsOwner(d.isOwner ?? false)
      }

      // Fallback: try legacy metaTokens/page doc for display name
      if (pageList.length === 0) {
        const tokenSnap = await getDoc(doc(db, 'users', u.uid, 'metaTokens', 'page'))
        if (tokenSnap.exists()) setPageData(tokenSnap.data() as PageTokenData)
      }

      // Respect previously selected page; fall back to first page
      const savedPageId = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
      const savedPage = pageList.find(p => p.pageId === savedPageId)
      const activePage = savedPage ?? pageList[0]
      const activePageId = activePage?.pageId ?? ''
      const activePageName = activePage?.pageName ?? ''

      if (activePage) setPageData({ pageId: activePage.pageId, pageName: activePage.pageName, igUserId: activePage.igUserId })
      setSelectedPageId(activePageId)
      if (activePageId) {
        localStorage.setItem('selectedPageId', activePageId)
        localStorage.setItem('selectedPageName', activePageName)
      }
      // Determine if user is admin (has Facebook token)
      const { getDocs: getDocsClient, collection: collectionClient } = await import('firebase/firestore')
      const tokensSnap = await getDocsClient(collectionClient(db, 'users', u.uid, 'metaTokens'))
      setIsAdmin(tokensSnap.docs.some(d => d.id !== 'userToken'))
      setUserName(u.displayName ?? u.email ?? '')

      await fetchPosts(idToken, activePageId)
      setLoading(false)
    })
    return unsub
  }, [router, fetchPosts])

  // Resolved date bounds
  const dateBounds = useMemo(() => {
    if (dateMode === 'custom' && customStart && customEnd) return { start: customStart, end: customEnd }
    if (!days) return { start: '2000-01-01', end: '9999-12-31' }
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }, [days, dateMode, customStart, customEnd])

  // Posts in date range (for summary cards)
  const rangedFb = useMemo(() => fbPosts.filter(p => {
    const d = p.createdTime.slice(0, 10); return d >= dateBounds.start && d <= dateBounds.end
  }), [fbPosts, dateBounds])

  const rangedIg = useMemo(() => igPosts.filter(p => {
    const d = p.timestamp.slice(0, 10); return d >= dateBounds.start && d <= dateBounds.end
  }), [igPosts, dateBounds])

  // Summary stats from ranged posts
  const stats = useMemo(() => {
    const totalReach = rangedFb.reduce((s, p) => s + (p.insights?.reach ?? 0), 0) + rangedIg.reduce((s, p) => s + (p.insights?.reach ?? 0), 0)
    const totalLikes = rangedFb.reduce((s, p) => s + (p.insights?.reactions ?? 0), 0) + rangedIg.reduce((s, p) => s + (p.insights?.likes ?? 0), 0)
    const totalComments = rangedFb.reduce((s, p) => s + (p.insights?.comments ?? 0), 0) + rangedIg.reduce((s, p) => s + (p.insights?.comments ?? 0), 0)
    const totalShares = rangedFb.reduce((s, p) => s + (p.insights?.shares ?? 0), 0) + rangedIg.reduce((s, p) => s + (p.insights?.shares ?? 0), 0)
    const avgEngRate = totalReach > 0 ? ((totalLikes + totalComments + totalShares) / totalReach * 100) : 0
    const reelsCount = rangedIg.filter(p => p.mediaType === 'REELS' || p.mediaType === 'VIDEO').length
    const total = rangedFb.length + rangedIg.length
    return { totalReach, totalLikes, totalComments, totalShares, avgEngRate, totalPosts: total, reelsCount }
  }, [rangedFb, rangedIg])

  // Chart data (daily aggregation, date-range filtered)
  const chartData = useMemo<DailyPoint[]>(() => {
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
      .filter(([fullDate]) => fullDate >= dateBounds.start && fullDate <= dateBounds.end)
      .map(([fullDate, d]) => ({
        date: fullDate.slice(5).replace('-', '/'),
        fullDate,
        reach: d.reach,
        likes: d.likes,
        comments: d.comments,
        shares: d.shares,
        engRate: d.reach > 0 ? Number(((d.likes + d.comments + d.shares) / d.reach * 100).toFixed(2)) : 0,
      }))
  }, [fbPosts, igPosts, dateBounds])

  // Table-filtered posts (type + search, independent of date range)
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

  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')
  const [skAutoSend, setSkAutoSend] = useState(false)
  const openSidekick = useCallback((prompt = '', autoSend = false) => {
    setSkInitPrompt(prompt)
    setSkAutoSend(autoSend)
    setSkOpen(true)
  }, [])

  async function handlePageChange(newPageId: string) {
    setSelectedPageId(newPageId)
    localStorage.setItem('selectedPageId', newPageId)
    const found = pages.find(p => p.pageId === newPageId)
    if (found) localStorage.setItem('selectedPageName', found.pageName)
    if (found) setPageData({ pageId: found.pageId, pageName: found.pageName, igUserId: found.igUserId })
    setFbPosts([])
    setIgPosts([])
    const u = auth.currentUser
    if (!u) return
    const idToken = await u.getIdToken()
    await fetchPosts(idToken, newPageId)
  }

  async function handleAddPage() {
    if (!addPageInput.trim()) return
    setAddPageError('')
    const u = auth.currentUser
    if (!u) return
    const idToken = await u.getIdToken()
    const res = await fetch('/api/pages/add', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIdentifier: addPageInput.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setAddPageError(data.error ?? '新增失敗'); return }
    // Refresh pages list
    const pagesRes = await fetch('/api/pages', { headers: { Authorization: `Bearer ${idToken}` } })
    if (pagesRes.ok) { const d = await pagesRes.json(); setPages(d.pages ?? []) }
    setAddingPage(false)
    setAddPageInput('')
  }


  async function handleSignOut() { await signOut(auth); router.replace('/auth/login') }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">載入中⋯⋯</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <ProfileMenu
              userName={userName}
              role={isAdmin ? 'admin' : 'viewer'}
              isOwner={isOwner}
              onSignOut={handleSignOut}
            />
            <div className="flex items-center gap-2">
              {pages.length > 1 ? (
                <select
                  value={selectedPageId}
                  onChange={e => handlePageChange(e.target.value)}
                  className="text-xs text-gray-500 font-medium border-0 bg-transparent cursor-pointer outline-none"
                >
                  {pages.map(p => <option key={p.pageId} value={p.pageId}>{p.pageName}</option>)}
                </select>
              ) : (
                pageData && <p className="text-xs text-gray-500 font-medium">{pageData.pageName}</p>
              )}
              {isAdmin && (addingPage ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={addPageInput}
                    onChange={e => setAddPageInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddPage(); if (e.key === 'Escape') { setAddingPage(false); setAddPageError('') } }}
                    placeholder="粉絲頁 ID 或 username"
                    className="text-xs border border-gray-200 rounded px-2 py-0.5 outline-none w-40"
                  />
                  <button onClick={handleAddPage} className="text-xs text-blue-500 hover:text-blue-700">新增</button>
                  <button onClick={() => { setAddingPage(false); setAddPageError('') }} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
                  {addPageError && <span className="text-xs text-red-500">{addPageError}</span>}
                </div>
              ) : (
                <button onClick={() => setAddingPage(true)} className="text-xs text-gray-300 hover:text-blue-500" title="新增粉絲頁">＋</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {(() => {
              const activePerms = pages.find(p => p.pageId === selectedPageId)?.permissions ?? null
              return (<>
                {(isAdmin || activePerms?.ads) && (
                  <button onClick={() => router.push('/dashboard/ads')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors">
                    📊 廣告儀表板
                  </button>
                )}
                {(isAdmin || activePerms?.sidekick) && (
                  <button className={`ads-sk-toggle-btn ${skOpen ? 'active' : ''}`} onClick={() => setSkOpen(v => !v)}>
                    ✨ AI Sidekick
                  </button>
                )}
              </>)
            })()}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-8 py-6">
        {!pageData ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-4 text-sm text-gray-500">尚未連接 Facebook 粉專</p>
            <button onClick={() => router.push('/auth/connect')} className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166FE5]">
              連接 Facebook
            </button>
          </div>
        ) : (
          <>
            {/* Date range selector — controls summary + chart */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ad-text2)' }}>資料區間</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {DATE_OPTS.map(opt => (
                  <button key={opt.days} onClick={() => { setDateMode('preset'); setDays(opt.days) }} style={dateBtnStyle(dateMode === 'preset' && days === opt.days)}>
                    {opt.label}
                  </button>
                ))}
                <button onClick={() => setDateMode('custom')} style={dateBtnStyle(dateMode === 'custom')}>自訂</button>
              </div>
              {dateMode === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={dateInputStyle} />
                  <span style={{ color: 'var(--ad-text3)' }}>至</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={dateInputStyle} />
                </div>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ad-text3)' }}>每日凌晨 3 點自動更新</span>
            </div>

            {/* Summary Strip */}
            <div className="ads-posts-summary-strip" style={{ marginBottom: 20 }}>
              {[
                { label: '總貼文數', value: stats.totalPosts, sub: `${stats.reelsCount} Reels · ${stats.totalPosts - stats.reelsCount} 貼文` },
                { label: '總觸擊', value: fmtBig(stats.totalReach), sub: 'FB + IG 貼文' },
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
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ad-text)', marginBottom: 14 }}>成效趨勢</div>
              <ContentChart data={chartData} />
            </div>

            {/* Table toolbar */}
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
              {activeTab === 'fb' && pageData && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 4px 12px' }}>
                  <FbMdImport pageId={pageData.pageId} onImported={async () => {
                    const u = auth.currentUser
                    if (!u) return
                    const idToken = await u.getIdToken()
                    const res = await fetch('/api/insights/fb', { headers: { Authorization: `Bearer ${idToken}` } })
                    if (res.ok) { const d = await res.json(); setFbPosts(d.posts ?? []) }
                  }} />
                  <FbCsvImport pageId={pageData.pageId} onImported={async () => {
                    const u = auth.currentUser
                    if (!u) return
                    const idToken = await u.getIdToken()
                    const res = await fetch('/api/insights/fb', { headers: { Authorization: `Bearer ${idToken}` } })
                    if (res.ok) { const d = await res.json(); setFbPosts(d.posts ?? []) }
                  }} />
                </div>
              )}
              {(() => {
                const canSidekick = isAdmin || !!pages.find(p => p.pageId === selectedPageId)?.permissions?.sidekick
                const askAI = canSidekick ? (q: string, a?: boolean) => openSidekick(q, a) : undefined
                return (<>
                  {activeTab === 'combined' && <CombinedPostsTable fbPosts={filteredFb} igPosts={filteredIg} onAskAI={askAI} />}
                  {activeTab === 'fb' && <FbPostsTable posts={filteredFb} onAskAI={askAI} />}
                  {activeTab === 'ig' && <IgPostsTable posts={filteredIg} onAskAI={askAI} />}
                </>)
              })()}
            </div>
          </>
        )}
      </div>
      {(isAdmin || pages.find(p => p.pageId === selectedPageId)?.permissions?.sidekick) && (
        <button className={`ads-sk-fab ${skOpen ? 'hidden' : ''}`} onClick={() => openSidekick()} title="AI Sidekick">✨</button>
      )}
      <AiSidekick
        open={skOpen}
        onClose={() => setSkOpen(false)}
        contextPage="posts"
        initialPrompt={skInitPrompt}
        autoSendPrompt={skAutoSend ? skInitPrompt : undefined}
        metricsContext={{
          totalPosts: stats.totalPosts,
          totalReach: stats.totalReach,
          totalLikes: stats.totalLikes,
          totalComments: stats.totalComments,
          totalShares: stats.totalShares,
          avgEngRate: stats.avgEngRate,
          reelsCount: stats.reelsCount,
          dateRange: dateMode === 'preset' ? (days === 0 ? '全部時間' : `近 ${days} 天`) : `${customStart} ~ ${customEnd}`,
        } satisfies MetricsContext}
        pageId={pageData?.pageId ?? undefined}
      />
    </main>
  )
}
