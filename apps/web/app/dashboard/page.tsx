'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { FbPostsTable } from '@/components/dashboard/FbPostsTable'
import { FbCsvImport } from '@/components/dashboard/FbCsvImport'
import { FbMdImport } from '@/components/dashboard/FbMdImport'
import { IgPostsTable } from '@/components/dashboard/IgPostsTable'
import { IgStoriesTable } from '@/components/dashboard/IgStoriesTable'
import type { IgStory } from '@/components/dashboard/IgStoriesTable'
import { CombinedPostsTable } from '@/components/dashboard/CombinedPostsTable'
import { ContentChart } from '@/components/dashboard/ContentChart'
import type { DailyPoint } from '@/components/dashboard/ContentChart'
import { AiSidekick } from '@/components/ads/AiSidekick'
import type { MetricsContext } from '@/components/ads/AiSidekick'
import { ProfileMenu } from '@/components/ProfileMenu'
import { NotificationBell } from '@/components/NotificationBell'
import { OnboardingModal } from '@/components/OnboardingModal'
import { DateField } from '@/components/ui/DateField'

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

const DATE_OPTS = [{ days: 7 }, { days: 30 }, { days: 90 }, { days: 0 }]

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
  const { L } = useLang()
  const [pageData, setPageData] = useState<PageTokenData | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [fbPosts, setFbPosts] = useState<FbPost[]>([])
  const [igPosts, setIgPosts] = useState<IgPost[]>([])
  const [igStories, setIgStories] = useState<IgStory[]>([])
  const [followerStats, setFollowerStats] = useState<{ date: string; total: number; net: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('combined')
  const [typeFilter, setTypeFilter] = useState<'all' | 'post' | 'reels' | 'stories'>('all')
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
  const [idToken, setIdToken] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const fetchPosts = useCallback(async (idToken: string, pageId: string, since?: string, until?: string) => {
    const headers = { Authorization: `Bearer ${idToken}` }
    const base = new URLSearchParams()
    if (pageId) base.set('pageId', pageId)
    const qs = base.toString() ? `?${base.toString()}` : '' // stories: no date filter (24h only)
    const range = new URLSearchParams(base)
    if (since) range.set('since', since)
    if (until) range.set('until', until)
    const rqs = range.toString() ? `?${range.toString()}` : '' // posts: date-range filtered
    const [fbRes, igRes, storiesRes, fbStoriesRes] = await Promise.all([
      fetch(`/api/insights/fb${rqs}`, { headers }),
      fetch(`/api/insights/ig${rqs}`, { headers }),
      fetch(`/api/insights/ig/stories${qs}`, { headers }),
      fetch(`/api/insights/fb/stories${qs}`, { headers }),
    ])
    if (fbRes.ok) { const d = await fbRes.json(); setFbPosts((d.posts ?? []).filter((p: FbPost) => p.message?.trim())); setFollowerStats(d.followerStats ?? []) }
    if (igRes.ok) { const d = await igRes.json(); setIgPosts(d.posts ?? []) }
    // Tag platform so the combined stories table can distinguish FB vs IG.
    const ig = storiesRes.ok ? ((await storiesRes.json()).stories ?? []) : []
    const fb = fbStoriesRes.ok ? ((await fbStoriesRes.json()).stories ?? []) : []
    setIgStories([
      ...ig.map((s: IgStory) => ({ ...s, platform: s.platform ?? 'IG' as const })),
      ...fb.map((s: IgStory) => ({ ...s, platform: 'FB' as const })),
    ])
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const idToken = await u.getIdToken()
      const headers = { Authorization: `Bearer ${idToken}` }

      // Fetch pages list from API (BFF — Admin SDK; client never reads Firestore)
      const pagesRes = await fetch('/api/pages', { headers })
      let pageList: PageInfo[] = []
      let adminFlag = false
      if (pagesRes.ok) {
        const d = await pagesRes.json()
        pageList = d.pages ?? []
        setPages(pageList)
        setIsOwner(d.isOwner ?? false)
        adminFlag = d.isAdmin ?? false
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
      // Admin flag comes from /api/pages (server-side), not a client Firestore read.
      setIsAdmin(adminFlag)
      setUserName(u.displayName ?? u.email ?? '')
      setIdToken(idToken)

      if (adminFlag && activePageId) {
        const skipped = sessionStorage.getItem(`onboardingSkipped_${activePageId}`)
        if (!skipped) {
          const onbRes = await fetch(`/api/user/onboarding?pageId=${activePageId}`, { headers })
          if (onbRes.ok) {
            const j = await onbRes.json()
            if (!j.data?.optimizationGoal) setShowOnboarding(true)
          }
        }
      }

      // Posts are fetched by the date-range effect below (keyed on page + date bounds).
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

  // (Re)fetch posts whenever the selected page or date range changes — the server now
  // queries by date range, so "全部" returns everything (capped) and 7/30/90d read only
  // what they need. loading stays true until the first fetch resolves; later refetches
  // update in place without flashing the spinner. "全部" sends 2000-01-01 → no lower bound.
  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    const since = days === 0 && dateMode === 'preset' ? undefined : dateBounds.start
    const until = days === 0 && dateMode === 'preset' ? undefined : dateBounds.end
    fetchPosts(idToken, selectedPageId, since, until).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [idToken, selectedPageId, dateBounds.start, dateBounds.end, days, dateMode, fetchPosts])

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

  // Follower summary: current total + net change across the selected range
  const followerSummary = useMemo(() => {
    const inRange = followerStats.filter(s => s.date >= dateBounds.start && s.date <= dateBounds.end)
    if (inRange.length === 0) {
      const latest = followerStats[followerStats.length - 1]
      return { total: latest?.total ?? 0, net: 0 }
    }
    const total = inRange[inRange.length - 1].total
    const net = total - inRange[0].total
    return { total, net }
  }, [followerStats, dateBounds])

  // Chart data (daily aggregation, date-range filtered)
  const chartData = useMemo<DailyPoint[]>(() => {
    const byDate = new Map<string, { reach: number; likes: number; comments: number; shares: number }>()
    for (const fb of fbPosts) {
      const d = fb.createdTime.slice(0, 10)
      const e = byDate.get(d) ?? { reach: 0, likes: 0, comments: 0, shares: 0 }
      byDate.set(d, { ...e, reach: e.reach + (fb.insights?.reach ?? 0), likes: e.likes + (fb.insights?.reactions ?? 0), comments: e.comments + (fb.insights?.comments ?? 0), shares: e.shares + (fb.insights?.shares ?? 0) })
    }
    for (const ig of igPosts) {
      const d = ig.timestamp.slice(0, 10)
      const e = byDate.get(d) ?? { reach: 0, likes: 0, comments: 0, shares: 0 }
      byDate.set(d, { ...e, reach: e.reach + (ig.insights?.reach ?? 0), likes: e.likes + (ig.insights?.likes ?? 0), comments: e.comments + (ig.insights?.comments ?? 0), shares: e.shares + (ig.insights?.shares ?? 0) })
    }
    // Union follower-stat dates so the follower trend shows even on days without posts
    const followerByDate = new Map(followerStats.map(s => [s.date, s]))
    for (const s of followerStats) {
      if (!byDate.has(s.date)) byDate.set(s.date, { reach: 0, likes: 0, comments: 0, shares: 0 })
    }

    let lastTotal = 0 // carry forward last known follower total across gap days
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fullDate, d]) => {
        const fs = followerByDate.get(fullDate)
        const total = fs?.total ?? lastTotal
        const net = fs?.net ?? 0
        if (fs?.total) lastTotal = fs.total
        const prevTotal = total - net
        return {
          fullDate,
          date: fullDate.slice(5).replace('-', '/'),
          reach: d.reach,
          likes: d.likes,
          comments: d.comments,
          shares: d.shares,
          engRate: d.reach > 0 ? Number(((d.likes + d.comments + d.shares) / d.reach * 100).toFixed(2)) : 0,
          followers: total,
          followerGrowth: prevTotal > 0 ? Number((net / prevTotal * 100).toFixed(2)) : 0,
        }
      })
      .filter(p => p.fullDate >= dateBounds.start && p.fullDate <= dateBounds.end)
  }, [fbPosts, igPosts, followerStats, dateBounds])

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

  // Stories are their own capped list, NOT bound to the posts' date range: IG
  // stories are 24h-ephemeral (always recent), but FB's Stories Archive returns
  // older stories too, and applying dateBounds hid those entirely. Show every
  // synced story — the table sorts newest-first. But DO respect the platform tab
  // (FB+IG / Facebook / Instagram): the FB tab shows only FB stories and vice versa.
  const filteredStories = useMemo(() => {
    if (activeTab === 'fb') return igStories.filter(s => s.platform === 'FB')
    if (activeTab === 'ig') return igStories.filter(s => s.platform === 'IG')
    return igStories
  }, [igStories, activeTab])

  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')
  const [skAutoSend, setSkAutoSend] = useState(false)
  const openSidekick = useCallback((prompt = '', autoSend = false) => {
    setSkInitPrompt(prompt)
    setSkAutoSend(autoSend)
    setSkOpen(true)
  }, [])

  function handlePageChange(newPageId: string) {
    setSelectedPageId(newPageId)
    localStorage.setItem('selectedPageId', newPageId)
    const found = pages.find(p => p.pageId === newPageId)
    if (found) localStorage.setItem('selectedPageName', found.pageName)
    if (found) setPageData({ pageId: found.pageId, pageName: found.pageName, igUserId: found.igUserId })
    setFbPosts([])
    setIgPosts([])
    // The date-range effect refetches automatically when selectedPageId changes.
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
    if (!res.ok) { setAddPageError(data.error ?? L('新增失敗', 'Failed to add')); return }
    // Refresh pages list
    const pagesRes = await fetch('/api/pages', { headers: { Authorization: `Bearer ${idToken}` } })
    if (pagesRes.ok) { const d = await pagesRes.json(); setPages(d.pages ?? []) }
    setAddingPage(false)
    setAddPageInput('')
  }


  async function handleSignOut() { await signOut(auth); router.replace('/auth/login') }

  // Manual "sync latest data" — refresh FB + IG posts (incl. reach via post_media_view)
  // for the current page, then refetch. FB/IG sync are per-page and use the caller's own
  // token, so only admins of this page can meaningfully trigger it.
  async function handleSync() {
    if (!selectedPageId || syncing) return
    setSyncing(true)
    try {
      const u = auth.currentUser
      if (!u) return
      const token = await u.getIdToken()
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      const body = JSON.stringify({ pageId: selectedPageId })
      await Promise.all([
        fetch('/api/insights/fb/sync', { method: 'POST', headers, body }).catch(() => null),
        fetch('/api/insights/ig/sync', { method: 'POST', headers, body }).catch(() => null),
      ])
      const since = days === 0 && dateMode === 'preset' ? undefined : dateBounds.start
      const until = days === 0 && dateMode === 'preset' ? undefined : dateBounds.end
      await fetchPosts(token, selectedPageId, since, until)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">{L('載入中⋯⋯', 'Loading…')}</p>
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
                    placeholder={L('粉絲頁 ID 或 username', 'Page ID or username')}
                    className="text-xs border border-gray-200 rounded px-2 py-0.5 outline-none w-40"
                  />
                  <button onClick={handleAddPage} className="text-xs text-blue-500 hover:text-blue-700">{L('新增', 'Add')}</button>
                  <button onClick={() => { setAddingPage(false); setAddPageError('') }} className="text-xs text-gray-400 hover:text-gray-600">{L('取消', 'Cancel')}</button>
                  {addPageError && <span className="text-xs text-red-500">{addPageError}</span>}
                </div>
              ) : (
                <button onClick={() => setAddingPage(true)} className="text-xs text-gray-300 hover:text-blue-500" title={L('新增粉絲頁', 'Add page')}>＋</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            {(() => {
              const activePerms = pages.find(p => p.pageId === selectedPageId)?.permissions ?? null
              return (<>
                {(isAdmin || activePerms?.ads) && (
                  <button onClick={() => router.push('/dashboard/ads')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors">
                    📊 {L('廣告儀表板', 'Ad Dashboard')}
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => router.push('/dashboard/links')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors">
                    🔗 {L('報名連結追蹤', 'Link Tracking')}
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => router.push('/dashboard/messages')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors">
                    💬 {L('私訊分析', 'Messages')}
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
            <p className="mb-4 text-sm text-gray-500">{L('尚未連接 Facebook 粉專', 'No Facebook Page connected yet')}</p>
            <button onClick={() => router.push('/auth/connect')} className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166FE5]">
              {L('連接 Facebook', 'Connect Facebook')}
            </button>
          </div>
        ) : (
          <>
            {/* Date range selector — controls summary + chart */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ad-text2)' }}>{L('資料區間', 'Date range')}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {DATE_OPTS.map(opt => (
                  <button key={opt.days} onClick={() => { setDateMode('preset'); setDays(opt.days) }} style={dateBtnStyle(dateMode === 'preset' && days === opt.days)}>
                    {opt.days === 0 ? L('全部', 'All') : L(`${opt.days}天`, `${opt.days}d`)}
                  </button>
                ))}
                <button onClick={() => setDateMode('custom')} style={dateBtnStyle(dateMode === 'custom')}>{L('自訂', 'Custom')}</button>
              </div>
              {dateMode === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <DateField value={customStart} onChange={setCustomStart} style={dateInputStyle} />
                  <span style={{ color: 'var(--ad-text3)' }}>{L('至', 'to')}</span>
                  <DateField value={customEnd} onChange={setCustomEnd} style={dateInputStyle} />
                </div>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {isAdmin && (
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', border: '1px solid var(--ad-border)', borderRadius: 8, background: 'var(--ad-surface)', color: 'var(--ad-text2)', cursor: syncing ? 'wait' : 'pointer', opacity: syncing ? 0.6 : 1 }}
                  >
                    {syncing ? L('↻ 同步中⋯', '↻ Syncing…') : L('↻ 同步最新資料', '↻ Sync latest data')}
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{L('每日凌晨 3 點自動更新', 'Auto-updates daily at 3 AM')}</span>
              </div>
            </div>

            {/* Summary Strip */}
            <div className="ads-posts-summary-strip" style={{ marginBottom: 20 }}>
              {[
                { label: L('總貼文數', 'Total posts'), value: stats.totalPosts, sub: L(`${stats.reelsCount} Reels · ${stats.totalPosts - stats.reelsCount} 貼文`, `${stats.reelsCount} Reels · ${stats.totalPosts - stats.reelsCount} posts`) },
                { label: L('總觸及', 'Total reach'), value: fmtBig(stats.totalReach), sub: L('FB 觀看 + IG 觸及', 'FB views + IG reach') },
                { label: L('總按讚', 'Total likes'), value: fmtBig(stats.totalLikes), sub: L(`留言 ${stats.totalComments} · 分享 ${stats.totalShares}`, `${stats.totalComments} comments · ${stats.totalShares} shares`) },
                { label: L('平均互動率', 'Avg engagement'), value: `${stats.avgEngRate.toFixed(2)}%`, sub: L('(按讚+留言+分享)/總觸及', '(likes+comments+shares)/reach') },
                { label: L('追蹤數', 'Followers'), value: followerSummary.total > 0 ? fmtBig(followerSummary.total) : '—', sub: followerSummary.total > 0 ? L(`本區間 ${followerSummary.net >= 0 ? '+' : ''}${followerSummary.net}`, `this period ${followerSummary.net >= 0 ? '+' : ''}${followerSummary.net}`) : L('尚未同步', 'Not synced') },
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
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ad-text)', marginBottom: 14 }}>{L('成效趨勢', 'Performance trend')}</div>
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
                {(['all', 'post', 'reels', 'stories'] as const).map(v => (
                  <button key={v} className={`ads-posts-type-chip ${typeFilter === v ? 'active' : ''}`} onClick={() => setTypeFilter(v)}>
                    {v === 'all' ? L('全部', 'All') : v === 'post' ? L('貼文', 'Posts') : v === 'reels' ? 'Reels' : L('限動', 'Stories')}
                  </button>
                ))}
              </div>
              <input className="ads-posts-search" placeholder={L('搜尋貼文內容…', 'Search posts…')} value={search} onChange={e => setSearch(e.target.value)} />
              <p style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ad-text3)' }}>{L('點擊欄位標題可排序', 'Click a column header to sort')}</p>
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
                if (typeFilter === 'stories') {
                  return <IgStoriesTable stories={filteredStories} onAskAI={askAI} />
                }
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
          dateRange: dateMode === 'preset' ? (days === 0 ? L('全部時間', 'All time') : L(`近 ${days} 天`, `Last ${days} days`)) : `${customStart} ~ ${customEnd}`,
        } satisfies MetricsContext}
        pageId={pageData?.pageId ?? undefined}
      />
      <footer className="mt-8 pb-6 text-center">
        <a href="/privacy" className="text-xs text-gray-400 hover:text-gray-600">Privacy Policy</a>
      </footer>
      {showOnboarding && isAdmin && idToken && (
        <OnboardingModal idToken={idToken} pageId={selectedPageId} onDone={() => setShowOnboarding(false)} />
      )}
    </main>
  )
}
