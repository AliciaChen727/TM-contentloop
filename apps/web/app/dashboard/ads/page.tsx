'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { MOCK_DATA } from '@/components/ads/mockData'
import { mapRawAdCreative, buildDiagnosis } from '@/lib/ads/diagnosis'
import { Icon } from '@/components/ads/Icon'
import { AiSidekick } from '@/components/ads/AiSidekick'
import { OverviewSection } from '@/components/ads/sections/OverviewSection'
import { DiagnosisSection } from '@/components/ads/sections/DiagnosisSection'
import { CreativeSection } from '@/components/ads/sections/CreativeSection'
import { CreativeTrendsSection } from '@/components/ads/sections/CreativeTrendsSection'
import { AudienceSection } from '@/components/ads/sections/AudienceSection'
import { PostsSection } from '@/components/ads/sections/PostsSection'
import { BestTimeSection } from '@/components/ads/sections/BestTimeSection'
import { BudgetSection } from '@/components/ads/sections/BudgetSection'
import { InsightsSection } from '@/components/ads/sections/InsightsSection'
import type { NavId, Post, AdData, LabelEntry, Experiment } from '@/components/ads/types'

const NAV: { id: NavId; label: string; icon: string; badge?: string }[] = [
  { id: 'overview', label: '總覽', icon: 'chart' },
  { id: 'insights', label: '洞察報告', icon: 'chart' },
  { id: 'diagnosis', label: '診斷建議', icon: 'alert' },
  { id: 'creative', label: '素材庫', icon: 'creative' },
  { id: 'trends', label: '成效趨勢', icon: 'chart' },
  { id: 'audience', label: '受眾分析', icon: 'chart' },
  { id: 'posts', label: '內容表現', icon: 'calendar' },
  { id: 'time', label: '最佳時段', icon: 'clock' },
  { id: 'budget', label: '預算模擬', icon: 'budget' },
]

const NAV_LABELS: Record<NavId, string> = {
  overview: '總覽', insights: '洞察報告', diagnosis: '診斷建議', creative: '素材庫', trends: '成效趨勢',
  audience: '受眾分析', posts: '內容表現', time: '最佳時段', budget: '預算模擬',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFbPost(p: any, adPostIds: Set<string>, adPostMetrics?: Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }>): Post {
  const shortId = p.id.includes('_') ? p.id.split('_').slice(1).join('_') : p.id
  const hasAd = adPostIds.has(shortId) || adPostIds.has(p.id) || (p.insights?.paidReach ?? 0) > 0
  const metrics = adPostMetrics?.[shortId] ?? adPostMetrics?.[p.id]
  return {
    id: p.id,
    date: p.createdTime?.slice(0, 10) ?? '',
    platform: 'FB',
    title: p.message || '（無文字內容）',
    reach: (p.insights?.reach ?? 0) > 0 ? p.insights.reach : null,
    likes: p.insights?.reactions ?? 0,
    comments: p.insights?.comments ?? 0,
    saves: null,
    shares: p.insights?.shares ?? 0,
    plays: null,
    type: 'post',
    url: p.permalink || '#',
    hasAd,
    paidReach: p.insights?.paidReach || metrics?.reach || 0,
    organicReach: p.insights?.organicReach ?? 0,
    adRoas: metrics?.roas,
    adSpend: metrics?.spend,
    adCpa: metrics?.cpa,
    adCtr: metrics?.ctr,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIgPost(p: any, igPostIds?: Set<string>, igPostMetrics?: Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }>): Post {
  const isVideo = p.mediaType === 'REELS' || p.mediaType === 'VIDEO'
  const hasAd = igPostIds?.has(p.id) ?? false
  const metrics = igPostMetrics?.[p.id]
  return {
    id: p.id,
    date: p.timestamp?.slice(0, 10) ?? '',
    platform: 'IG',
    title: p.caption || '（無文字內容）',
    reach: p.insights?.reach ?? 0,
    likes: p.insights?.likes ?? 0,
    comments: p.insights?.comments ?? 0,
    saves: p.insights?.saved ?? 0,
    shares: p.insights?.shares ?? 0,
    plays: isVideo && (p.insights?.views ?? 0) > 0 ? p.insights.views : null,
    type: isVideo ? 'reels' : 'post',
    url: p.permalink || '#',
    hasAd,
    paidReach: metrics?.reach ?? 0,
    adRoas: metrics?.roas,
    adSpend: metrics?.spend,
    adCpa: metrics?.cpa,
    adCtr: metrics?.ctr,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAdData(raw: any): AdData {
  const s = raw.summary ?? {}
  const from = raw.dateRange?.from ?? ''
  const to = raw.dateRange?.to ?? ''
  const creatives = Array.isArray(raw.adCreatives)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.adCreatives.map((c: any, i: number) => mapRawAdCreative(c, i))
    : []
  // Only feed a REAL budget into diagnosis. We don't yet fetch ad-account budget
  // from Meta, so this is 0 → the budget-overspend rule stays silent instead of
  // comparing real spend against a fake mock budget (which was misleading).
  const realBudget = typeof s.budget === 'number' ? s.budget : 0
  const realCreatives = creatives.length > 0
  const diagnosis = buildDiagnosis(s as Record<string, number>, realCreatives ? creatives : [], realBudget)

  // Real adsets from per-creative data
  const realAdsets = realCreatives
    ? creatives.map((c: ReturnType<typeof mapRawAdCreative>) => ({
        id: c.id,
        name: c.name,
        // Real configured budget from Meta; fall back to a spend-based estimate only
        // when Meta returns no budget for that ad.
        budget: c.budget > 0 ? Math.round(c.budget) : (c.spend > 0 ? Math.round(c.spend / 0.8) : 1000),
        spent: Math.round(c.spend),
        roas: c.roas,
        cpa: Math.round(c.cpa),
      }))
    : []

  // Real weekly ROAS from daily data
  const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dayMap: Record<number, { sum: number; count: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (raw.daily ?? []).forEach((d: any) => {
    const dow = new Date(d.date).getDay()
    if (!dayMap[dow]) dayMap[dow] = { sum: 0, count: 0 }
    dayMap[dow].sum += d.roas ?? 0
    dayMap[dow].count++
  })
  const weeklyRoas = [1, 2, 3, 4, 5, 6, 0].map(dow => ({
    day: DAY_NAMES[dow],
    roas: dayMap[dow] ? parseFloat((dayMap[dow].sum / dayMap[dow].count).toFixed(2)) : 0,
    spend: 0,
  }))
  const realWeekly = weeklyRoas

  // Real hourly ROAS from breakdown data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawHourly: { hour: number; spend: number; roas: number }[] = raw.hourly ?? []
  const realHourly = rawHourly.length > 0
    ? Array.from({ length: 24 }, (_, hour) => {
        const h = rawHourly.find(r => r.hour === hour)
        return { hour, roas: h?.roas ?? 0, spend: h?.spend ?? 0 }
      })
    : Array.from({ length: 24 }, (_, hour) => ({ hour, roas: 0, spend: 0 }))

  const conversionType: string = s.conversionType ?? raw.conversionType ?? 'purchase'

  return {
    ...MOCK_DATA,
    creatives,
    diagnosis,
    conversionType,
    creativeTrends: Array.isArray(raw.creativeTrends) ? raw.creativeTrends : [],
    demographics: Array.isArray(raw.demographics) ? raw.demographics : [],
    platformBreakdown: Array.isArray(raw.platformBreakdown) ? raw.platformBreakdown : [],
    funnelStages: Array.isArray(raw.funnelStages) ? raw.funnelStages : [],
    budget: { ...MOCK_DATA.budget, adsets: realAdsets },
    bestTime: { ...MOCK_DATA.bestTime, weekly: realWeekly, hourly: realHourly },
    overview: {
      ...MOCK_DATA.overview,
      dateRange: `${from} ~ ${to}`,
      summary: {
        spend: s.spend,
        budget: MOCK_DATA.overview.summary.budget,
        roas: s.roas,
        roasTarget: MOCK_DATA.overview.summary.roasTarget,
        cpa: s.cpa,
        cpaTarget: MOCK_DATA.overview.summary.cpaTarget,
        ctr: s.ctr,
        cpm: s.cpm,
        reach: s.reach,
        impressions: s.impressions,
        frequency: s.frequency,
        conversions: s.conversions,
        revenue: s.revenue,
        clicks: s.clicks ?? 0,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dailySpend: (raw.daily ?? []).map((d: any) => ({
        date: d.date,
        spend: d.spend,
        revenue: d.revenue,
        roas: d.roas,
        clicks: d.clicks ?? 0,
        conversions: d.conversions ?? 0,
      })),
    },
  }
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '剛剛'
  if (mins < 60) return `${mins} 分鐘前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小時前`
  return `${Math.floor(hrs / 24)} 天前`
}

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000

export default function AdsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  // Deep link: ?section=diagnosis opens that nav section directly (from the alert
  // email「查看 AI 診斷」button and the 鈴鐺 notification deepLink).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = new URLSearchParams(window.location.search).get('section')
    if (s && NAV.some(n => n.id === s)) setActive(s as NavId)
  }, [])
  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')
  const [skAutoSend, setSkAutoSend] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [realPosts, setRealPosts] = useState<Post[] | null>(null)
  const [adData, setAdData] = useState<AdData>(MOCK_DATA)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState('')
  const [selectedPageName, setSelectedPageName] = useState('')
  const [pages, setPages] = useState<{ pageId: string; pageName: string }[]>([])
  const [canSidekick, setCanSidekick] = useState(false)
  const [canSync, setCanSync] = useState(false)
  const [showPageMenu, setShowPageMenu] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [creativeLabels, setCreativeLabels] = useState<Record<string, LabelEntry>>({})
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [idTokenRef, setIdTokenRef] = useState('')
  const [optimizationGoal, setOptimizationGoal] = useState<'clicks' | 'conversion' | 'reach' | 'event' | null>(null)

  type AdMetricsMap = Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }>
  async function fetchAdData(idToken: string, pageId?: string): Promise<{ adPostIds: Set<string>; adPostMetrics: AdMetricsMap; igPostIds: Set<string>; igPostMetrics: AdMetricsMap }> {
    const pid = pageId ?? selectedPageId
    const qs = pid ? `?pageId=${pid}` : ''
    const res = await fetch(`/api/ads/data${qs}`, { headers: { Authorization: `Bearer ${idToken}` } })
    if (!res.ok) return { adPostIds: new Set(), adPostMetrics: {}, igPostIds: new Set(), igPostMetrics: {} }
    const json = await res.json()
    if (json.data) {
      setAdData(buildAdData(json.data))
      setLastSync(json.data.syncedAt ?? null)
      return {
        adPostIds: new Set<string>(json.data.adPostIds ?? []),
        adPostMetrics: json.data.adPostMetrics ?? {},
        igPostIds: new Set<string>(json.data.igPostIds ?? []),
        igPostMetrics: json.data.igPostMetrics ?? {},
      }
    }
    return { adPostIds: new Set(), adPostMetrics: {}, igPostIds: new Set(), igPostMetrics: {} }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      if (!u) { router.replace('/auth/login'); return }

      try {
        const idToken = await u.getIdToken()
        const headers = { Authorization: `Bearer ${idToken}` }
        // URL ?pageId= wins (e.g. from email "AI 診斷" link), else last selection
        const urlPageId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('pageId') : null
        const pageId = urlPageId || ((typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : '') ?? '')
        const pageName = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageName') : '') ?? ''
        setSelectedPageId(pageId)
        setSelectedPageName(pageName)

        // Load all managed pages and check permission
        const pagesRes = await fetch('/api/pages', { headers })
        if (pagesRes.ok) {
          const pagesJson = await pagesRes.json()
          const allPages: Array<{ pageId: string; pageName: string; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } | null }> = pagesJson.pages ?? []
          setPages(allPages)
          // Sync display name + persist selection for the resolved pageId
          const matched = allPages.find(p => p.pageId === pageId)
          if (matched?.pageName) {
            setSelectedPageName(matched.pageName)
            if (typeof window !== 'undefined') {
              localStorage.setItem('selectedPageId', pageId)
              localStorage.setItem('selectedPageName', matched.pageName)
            }
          }
          // Pages from metaTokens (admin pages) have no permissions field; viewer pages have permissions object
          const isAdminUser = allPages.some(p => p.permissions === undefined || p.permissions === null)
          if (!isAdminUser) {
            const activePage = allPages.find(p => p.pageId === pageId) ?? allPages[0]
            if (!activePage?.permissions?.ads) {
              router.replace('/dashboard')
              return
            }
            setCanSidekick(!!activePage?.permissions?.sidekick)
            setCanSync(!!activePage?.permissions?.syncAds)
          } else {
            setCanSidekick(true)
            setCanSync(true)
          }
        }
        setAuthed(true)

        fetch(`/api/user/onboarding${pageId ? `?pageId=${pageId}` : ''}`, { headers }).then(async r => {
          if (!r.ok) return
          const j = await r.json()
          if (j.data?.optimizationGoal) setOptimizationGoal(j.data.optimizationGoal)
        }).catch(() => {})

        const qs = pageId ? `?pageId=${pageId}` : ''
        const [fbRes, igRes, adRes] = await Promise.all([
          fetch(`/api/insights/fb${qs}`, { headers }),
          fetch(`/api/insights/ig${qs}`, { headers }),
          fetch(`/api/ads/data${qs}`, { headers }),
        ])

        setIdTokenRef(idToken)

        const adJson = adRes.ok ? await adRes.json() : null
        const initialAdPostIds = new Set<string>(adJson?.data?.adPostIds ?? [])
        const initialAdPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }> = adJson?.data?.adPostMetrics ?? {}
        const initialIgPostIds = new Set<string>(adJson?.data?.igPostIds ?? [])
        const initialIgPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }> = adJson?.data?.igPostMetrics ?? {}
        if (adJson?.data) {
          setAdData(buildAdData(adJson.data))
          setLastSync(adJson.data.syncedAt ?? null)
        }

        if (pageId) {
          const [labelsRes, expRes] = await Promise.all([
            fetch(`/api/ads/labels?pageId=${pageId}`, { headers }),
            fetch(`/api/ads/experiments?pageId=${pageId}`, { headers }),
          ])
          if (labelsRes.ok) {
            const labelsJson = await labelsRes.json()
            setCreativeLabels(labelsJson.labels ?? {})
          }
          if (expRes.ok) {
            const expJson = await expRes.json()
            setExperiments(expJson.experiments ?? [])
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fbJson = fbRes.ok ? await fbRes.json() : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fbPosts: Post[] = (fbJson?.posts ?? []).filter((p: any) => p.message).map((p: any) => mapFbPost(p, initialAdPostIds, initialAdPostMetrics))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const igJson = igRes.ok ? await igRes.json() : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const igPosts: Post[] = (igJson?.posts ?? []).filter((p: any) => p.caption).map((p: any) => mapIgPost(p, initialIgPostIds, initialIgPostMetrics))
        const merged = [...fbPosts, ...igPosts].sort((a, b) => b.date.localeCompare(a.date))
        setRealPosts(merged)
        setDataLoaded(true)
      } catch (err) {
        console.error('ads page load error', err)
        setRealPosts([])
        setDataLoaded(true)
      }
    })
    return unsub
  }, [router])

  useEffect(() => {
    const parts = adData.overview.dateRange?.split(' ~ ')
    if (parts?.length === 2 && parts[0] && parts[1]) {
      setDateFrom(parts[0])
      setDateTo(parts[1])
    }
  }, [adData.overview.dateRange])

  async function handleSync(since?: string, until?: string) {
    // Respect the user's selected range exactly — do NOT force the end date to today.
    const syncFrom = since ?? dateFrom
    const syncTo = until ?? dateTo
    if (since) setDateFrom(since)
    if (until) setDateTo(until)
    setSyncing(true)
    setSyncError(null)
    try {
      const u = auth.currentUser
      if (!u) return
      const idToken = await u.getIdToken()
      const res = await fetch('/api/ads/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId, since: syncFrom, until: syncTo }),
      })
      const json = await res.json()
      if (json._debug) console.log('[ads sync debug]', json._debug)
      if (!res.ok) { setSyncError(json.error ?? '同步失敗'); return }
      // Await IG sync so errors are surfaced to the user
      if (selectedPageId) {
        try {
          const [igSyncRes, fbSyncRes] = await Promise.all([
            fetch('/api/insights/ig/sync', {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId: selectedPageId }),
            }),
            fetch('/api/insights/fb/sync', {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId: selectedPageId }),
            }),
          ])
          const igJson = await igSyncRes.json()
          if (!igSyncRes.ok) console.warn('[ig sync]', igJson.error ?? '未知錯誤')
          const fbSyncJson = await fbSyncRes.json()
          if (!fbSyncRes.ok) console.warn('[fb sync]', fbSyncJson.error ?? '未知錯誤')
        } catch { /* ignore */ }
      }
      const { adPostIds: newIds, adPostMetrics: newMetrics, igPostIds: newIgIds, igPostMetrics: newIgMetrics } = await fetchAdData(idToken, selectedPageId)
      setRealPosts(prev => prev ? prev.map(p => {
        if (p.platform === 'FB') {
          const shortId = p.id.includes('_') ? p.id.split('_').slice(1).join('_') : p.id
          const m = newMetrics[shortId] ?? newMetrics[p.id]
          return {
            ...p,
            hasAd: p.hasAd || newIds.has(shortId) || newIds.has(p.id),
            adRoas: m?.roas ?? p.adRoas,
            adSpend: m?.spend ?? p.adSpend,
            adCpa: m?.cpa ?? p.adCpa,
            adCtr: m?.ctr ?? p.adCtr,
          }
        }
        if (p.platform === 'IG') {
          const m = newIgMetrics[p.id]
          return {
            ...p,
            hasAd: p.hasAd || newIgIds.has(p.id),
            adRoas: m?.roas ?? p.adRoas,
            adSpend: m?.spend ?? p.adSpend,
            adCpa: m?.cpa ?? p.adCpa,
            adCtr: m?.ctr ?? p.adCtr,
            paidReach: m?.reach ?? p.paidReach,
          }
        }
        return p
      }) : prev)
      // Reload full post list so newly-published posts also appear
      const u2 = auth.currentUser
      if (u2) {
        const freshToken = await u2.getIdToken()
        const qs2 = selectedPageId ? `?pageId=${selectedPageId}` : ''
        const h2 = { Authorization: `Bearer ${freshToken}` }
        const [fbRefresh, igRefresh] = await Promise.all([
          fetch(`/api/insights/fb${qs2}`, { headers: h2 }),
          fetch(`/api/insights/ig${qs2}`, { headers: h2 }),
        ])
        const fbJson2 = fbRefresh.ok ? await fbRefresh.json() : null
        const igJson2 = igRefresh.ok ? await igRefresh.json() : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fbPosts2: Post[] = (fbJson2?.posts ?? []).filter((p: any) => p.message).map((p: any) => mapFbPost(p, newIds, newMetrics))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const igPosts2: Post[] = (igJson2?.posts ?? []).filter((p: any) => p.caption).map((p: any) => mapIgPost(p, newIgIds, newIgMetrics))
        setRealPosts([...fbPosts2, ...igPosts2].sort((a, b) => b.date.localeCompare(a.date)))
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : '同步失敗')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!authed || !selectedPageId) return
    const id = setInterval(() => {
      if (!syncing) handleSync()
    }, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [authed, selectedPageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the optimization goal in sync with the active page (drives KPI ordering).
  // Single source of truth: refetch whenever selectedPageId changes.
  useEffect(() => {
    if (!authed || !selectedPageId) return
    const u = auth.currentUser
    if (!u) return
    let cancelled = false
    u.getIdToken().then(token =>
      fetch(`/api/user/onboarding?pageId=${selectedPageId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async r => {
          if (!r.ok) { if (!cancelled) setOptimizationGoal(null); return }
          const j = await r.json()
          if (!cancelled) setOptimizationGoal(j.data?.optimizationGoal ?? null)
        })
        .catch(() => {})
    )
    return () => { cancelled = true }
  }, [authed, selectedPageId])

  async function handlePageSwitch(pid: string, pname: string) {
    setShowPageMenu(false)
    if (pid === selectedPageId) return
    setSelectedPageId(pid)
    setSelectedPageName(pname)
    localStorage.setItem('selectedPageId', pid)
    localStorage.setItem('selectedPageName', pname)
    setDataLoaded(false)
    setRealPosts(null)
    const u = auth.currentUser
    if (!u) return
    const idToken = await u.getIdToken()
    const headers = { Authorization: `Bearer ${idToken}` }
    const qs = pid ? `?pageId=${pid}` : ''
    // (optimizationGoal is refreshed by the selectedPageId-keyed effect.)
    const [fbRes, igRes, adRes] = await Promise.all([
      fetch(`/api/insights/fb${qs}`, { headers }),
      fetch(`/api/insights/ig${qs}`, { headers }),
      fetch(`/api/ads/data${qs}`, { headers }),
    ])
    const adJson = adRes.ok ? await adRes.json() : null
    const adPostIds = new Set<string>(adJson?.data?.adPostIds ?? [])
    const adPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number }> = adJson?.data?.adPostMetrics ?? {}
    const igPostIdsSwitch = new Set<string>(adJson?.data?.igPostIds ?? [])
    const igPostMetricsSwitch: Record<string, { spend: number; roas: number; cpa: number; ctr: number }> = adJson?.data?.igPostMetrics ?? {}
    if (adJson?.data) {
      setAdData(buildAdData(adJson.data))
      setLastSync(adJson.data.syncedAt ?? null)
    } else {
      setAdData(MOCK_DATA)
      setLastSync(null)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fbJson = fbRes.ok ? await fbRes.json() : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fbPosts: Post[] = (fbJson?.posts ?? []).filter((p: any) => p.message).map((p: any) => mapFbPost(p, adPostIds, adPostMetrics))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const igJson = igRes.ok ? await igRes.json() : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const igPosts: Post[] = (igJson?.posts ?? []).filter((p: any) => p.caption).map((p: any) => mapIgPost(p, igPostIdsSwitch, igPostMetricsSwitch))
    setRealPosts([...fbPosts, ...igPosts].sort((a, b) => b.date.localeCompare(a.date)))
    if (pid) {
      const [labelsRes, expRes] = await Promise.all([
        fetch(`/api/ads/labels?pageId=${pid}`, { headers }),
        fetch(`/api/ads/experiments?pageId=${pid}`, { headers }),
      ])
      if (labelsRes.ok) {
        const labelsJson = await labelsRes.json()
        setCreativeLabels(labelsJson.labels ?? {})
      }
      if (expRes.ok) {
        const expJson = await expRes.json()
        setExperiments(expJson.experiments ?? [])
      }
    }
    setDataLoaded(true)
  }

  const openSidekick = useCallback((prompt = '', autoSend = false) => {
    setSkInitPrompt(prompt)
    setSkAutoSend(autoSend)
    setSkOpen(true)
  }, [])

  function exportJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      page: selectedPageName || 'unknown',
      dateRange: `${dateFrom} ~ ${dateTo}`,
      summary: adData.overview.summary,
      dailySpend: adData.overview.dailySpend,
      creatives: adData.creatives,
      diagnosis: adData.diagnosis.map(d => ({ severity: d.severity, title: d.title, desc: d.desc, action: d.action })),
      bestTime: adData.bestTime,
      budget: { ...adData.budget },
      posts: (realPosts ?? []).filter(p => p.date >= dateFrom && p.date <= dateTo).map(p => ({
        id: p.id,
        date: p.date,
        platform: p.platform,
        type: p.type,
        title: p.title,
        reach: p.reach,
        organicReach: p.organicReach ?? null,
        paidReach: p.paidReach ?? null,
        likes: p.likes,
        comments: p.comments,
        saves: p.saves,
        shares: p.shares,
        plays: p.plays,
        engagementRate: (p.reach && p.reach > 0)
          ? parseFloat(((p.likes + p.comments + p.shares) / p.reach * 100).toFixed(2))
          : null,
        hasAd: p.hasAd,
        adSpend: p.adSpend ?? null,
        adRoas: p.adRoas ?? null,
        adCpa: p.adCpa ?? null,
        adCtr: p.adCtr ?? null,
        url: p.url,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ads-report-${dateFrom}_${dateTo}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  function exportCSV() {
    const s = adData.overview.summary
    const lines: string[] = []
    const row = (...cols: (string | number | undefined)[]) =>
      lines.push(cols.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))

    row('整體指標', '')
    row('指標', '數值')
    row('日期範圍', `${dateFrom} ~ ${dateTo}`)
    row('總花費', s.spend ?? 0)
    row('CPL (點擊成本)', s.cpa ?? 0)
    row('CTR (%)', s.ctr ?? 0)
    row('CPA', s.cpa ?? 0)
    row('總觸及', s.reach ?? 0)
    row('頻率', s.frequency ?? 0)
    lines.push('')

    row('素材績效', '', '', '', '', '')
    row('名稱', '花費', '點擊效益', 'CTR(%)', 'CPL', '狀態')
    adData.creatives.forEach(c => row(c.name, c.spend, c.roas, c.ctr, c.cpa, c.status))
    lines.push('')

    row('每日花費', '', '', '')
    row('日期', '花費', '點擊數', '點擊效益')
    adData.overview.dailySpend?.forEach(d => row(d.date, d.spend, d.revenue, d.roas))
    lines.push('')

    row('診斷項目', '', '', '')
    row('嚴重度', '標題', '描述', '建議行動')
    adData.diagnosis.forEach(d => row(d.severity, d.title, d.desc, d.action))
    lines.push('')

    row('內容表現', '', '', '', '', '', '', '', '', '', '', '', '')
    row('日期', '平台', '類型', '標題', '觸及', '自然觸及', '付費觸及', '按讚', '留言', '收藏', '分享', '播放', '互動率(%)', '有廣告', '廣告花費', '廣告CPL', '廣告CTR(%)')
    ;(realPosts ?? []).filter(p => p.date >= dateFrom && p.date <= dateTo).forEach(p => {
      const er = (p.reach && p.reach > 0)
        ? ((p.likes + p.comments + p.shares) / p.reach * 100).toFixed(2)
        : ''
      row(p.date, p.platform, p.type, p.title, p.reach ?? '', p.organicReach ?? '', p.paidReach ?? '', p.likes, p.comments, p.saves ?? '', p.shares, p.plays ?? '', er, p.hasAd ? '是' : '否', p.adSpend ?? '', p.adRoas ?? '', p.adCpa ?? '', p.adCtr ?? '')
    })

    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ads-report-${dateFrom}_${dateTo}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">載入中⋯⋯</p>
      </main>
    )
  }

  return (
    <div className="ads-root" style={{ display: 'flex', minHeight: '100vh', background: 'var(--ad-bg)', fontFamily: 'var(--font-dm-sans)', color: 'var(--ad-text)', fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: 'antialiased' }}>

      {/* Left Nav */}
      <nav className="ads-nav">
        <div className="ads-nav-logo" style={{ position: 'relative' }}>
          {pages.length > 1 ? (
            <button
              onClick={() => setShowPageMenu(p => !p)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
            >
              <div className="brand" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                {selectedPageName || 'ContentLoop'}
                <span style={{ fontSize: 10, color: 'var(--ad-text3)' }}>▾</span>
              </div>
              <div className="sub">廣告儀表板</div>
            </button>
          ) : (
            <>
              <div className="brand" style={{ fontSize: 13 }}>{selectedPageName || 'ContentLoop'}</div>
              <div className="sub">廣告儀表板</div>
            </>
          )}
          {showPageMenu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowPageMenu(false)} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white', border: '1px solid var(--ad-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>
                {pages.map(p => (
                  <div
                    key={p.pageId}
                    onClick={() => handlePageSwitch(p.pageId, p.pageName)}
                    style={{ padding: '9px 14px', fontSize: 12.5, cursor: 'pointer', fontWeight: p.pageId === selectedPageId ? 700 : 400, color: p.pageId === selectedPageId ? 'var(--ad-blue)' : 'var(--ad-text)', background: p.pageId === selectedPageId ? 'var(--ad-surface2)' : 'transparent' }}
                    onMouseEnter={e => { if (p.pageId !== selectedPageId) (e.currentTarget as HTMLElement).style.background = 'var(--ad-surface)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = p.pageId === selectedPageId ? 'var(--ad-surface2)' : 'transparent' }}
                  >
                    {p.pageName || p.pageId}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
          <div className="ads-nav-section">主要功能</div>
          {NAV.map(item => (
            <div key={item.id} className={`ads-nav-item ${active === item.id ? 'active' : ''}`} onClick={() => setActive(item.id)}>
              <Icon name={item.icon} size={15} color={active === item.id ? 'var(--ad-blue)' : 'var(--ad-text3)'} />
              {item.label}
              {item.badge && <span className="ads-nav-badge">{item.badge}</span>}
            </div>
          ))}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>頻道</div>
          {[['Meta', '#888'], ['Facebook', '#1877F2'], ['Instagram', '#E1306C']].map(([l, c]) => (
            <div key={l} className="ads-nav-item" style={{ paddingLeft: 14, cursor: 'default' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c, width: 16, display: 'inline-block' }}>{l[0]}</span>
              {l}
            </div>
          ))}
          {canSidekick && (
            <>
              <div className="ads-nav-section" style={{ marginTop: 8 }}>AI 助手</div>
              <div className="ads-nav-sk-btn" onClick={() => openSidekick()}>
                <span style={{ fontSize: 18 }}>✨</span>
                <div>
                  <div className="sk-label">AI Sidekick</div>
                  <div className="sk-sub">問我任何廣告問題</div>
                </div>
              </div>
            </>
          )}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>導覽</div>
          <div className="ads-nav-item" onClick={() => router.push('/dashboard')}>
            <Icon name="ads" size={15} color="var(--ad-text3)" />
            ← 回內容儀表板
          </div>
        </div>
        <div className="ads-nav-footer">
          <div>最後更新</div>
          <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11 }}>
            {lastSync ? formatRelativeTime(lastSync) : '— 尚未同步'}
          </div>
        </div>
      </nav>

      {/* Main area */}
      <div className={`ads-main ${skOpen ? 'sk-open' : ''}`}>
        <header className="ads-topbar">
          <span className="ads-topbar-title">{NAV_LABELS[active]}</span>
          <div className="ads-channel-badge">
            <Icon name="meta" size={13} color="var(--ad-blue)" />Meta Ads
          </div>
          <div style={{ position: 'relative' }}>
            <div className="ads-date-pill" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowDatePicker(p => !p)}>
              <Icon name="calendar" size={12} />{dateFrom} ~ {dateTo} ▾
            </div>
            {showDatePicker && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowDatePicker(false)} />
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: 'white', border: '1px solid var(--ad-border)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, padding: '14px 16px', minWidth: 260 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ad-text2)', marginBottom: 10 }}>自訂日期範圍</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <input type="date" value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)}
                      style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--ad-border)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', outline: 'none' }} />
                    <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>至</span>
                    <input type="date" value={dateTo} min={dateFrom} max={new Date().toISOString().slice(0, 10)} onChange={e => setDateTo(e.target.value)}
                      style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--ad-border)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', outline: 'none' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {([['近 7 天', 7], ['近 14 天', 14], ['近 30 天', 30]] as [string, number][]).map(([label, days]) => (
                      <button key={label} style={{ flex: 1, padding: '5px 0', fontSize: 11.5, border: '1px solid var(--ad-border)', borderRadius: 6, background: 'var(--ad-surface)', cursor: 'pointer', color: 'var(--ad-text2)' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const to = new Date()
                          const from = new Date(); from.setDate(from.getDate() - days)
                          const f = from.toISOString().slice(0, 10)
                          const t = to.toISOString().slice(0, 10)
                          setShowDatePicker(false)
                          handleSync(f, t)
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button className="ads-btn primary" style={{ width: '100%', justifyContent: 'center', fontSize: 12.5 }}
                    onClick={(e) => { e.stopPropagation(); setShowDatePicker(false); handleSync() }}>
                    套用並同步資料
                  </button>
                </div>
              </>
            )}
          </div>
          {canSidekick && (
            <button className={`ads-sk-toggle-btn ${skOpen ? 'active' : ''}`} onClick={() => setSkOpen(v => !v)}>
              ✨ AI Sidekick
            </button>
          )}
          {canSync && <button className="ads-btn" onClick={() => handleSync()} disabled={syncing} style={{ fontSize: 12.5, padding: '6px 12px', border: '1px solid var(--ad-border)', borderRadius: 8, background: 'var(--ad-surface)', cursor: syncing ? 'wait' : 'pointer', color: syncError ? 'var(--ad-red, #e53e3e)' : 'var(--ad-text2)' }}>
            {syncing ? '同步中⋯' : syncError ? `⚠ ${syncError}` : '↻ 同步廣告資料'}
          </button>}
          <div style={{ position: 'relative' }}>
            <button className="ads-btn primary" onClick={() => setShowExportMenu(p => !p)}>
              <Icon name="download" size={13} color="white" />匯出報告 ▾
            </button>
            {showExportMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowExportMenu(false)} />
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'white', border: '1px solid var(--ad-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 148, overflow: 'hidden' }}>
                  <button style={{ display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }} onClick={exportJSON}>📦 匯出 JSON</button>
                  <button style={{ display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }} onClick={exportCSV}>📊 匯出 CSV</button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="ads-content">
          {!dataLoaded ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
              <p style={{ fontSize: 14, color: 'var(--ad-text3)' }}>載入中⋯⋯</p>
            </div>
          ) : (
            <>
              {active === 'overview' && <OverviewSection data={adData} onAskAI={canSidekick ? openSidekick : undefined} posts={realPosts} optimizationGoal={optimizationGoal} />}
              {active === 'insights' && <InsightsSection pageId={selectedPageId} onAskAI={canSidekick ? openSidekick : undefined} />}
              {active === 'diagnosis' && <DiagnosisSection data={adData} posts={realPosts} onAskAI={canSidekick ? openSidekick : undefined} />}
              {active === 'creative' && <CreativeSection
                data={adData}
                onAskAI={canSidekick ? openSidekick : undefined}
                creativeLabels={creativeLabels}
                experiments={experiments}
                onLabelChange={selectedPageId ? async (adId, variant, experimentId) => {
                  setCreativeLabels(prev => {
                    if (variant === null) { const n = { ...prev }; delete n[adId]; return n }
                    return { ...prev, [adId]: { variant, experimentId: experimentId ?? '' } }
                  })
                  await fetch('/api/ads/labels', { method: 'POST', headers: { Authorization: `Bearer ${idTokenRef}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: selectedPageId, adId, variant, experimentId }) })
                } : undefined}
                onCreateExperiment={selectedPageId ? async (name) => {
                  const res = await fetch('/api/ads/experiments', { method: 'POST', headers: { Authorization: `Bearer ${idTokenRef}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: selectedPageId, action: 'create', name }) })
                  const { id } = res.ok ? await res.json() : { id: '' }
                  if (id) setExperiments(prev => [...prev, { id, name, aiDiagnosis: '', winner: 'pending' }])
                  return id
                } : undefined}
                onExperimentUpdate={selectedPageId ? async (experimentId, update) => {
                  setExperiments(prev => prev.map(e => e.id === experimentId ? { ...e, ...update } : e))
                  await fetch('/api/ads/experiments', { method: 'POST', headers: { Authorization: `Bearer ${idTokenRef}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: selectedPageId, experimentId, ...update }) })
                } : undefined}
                onDeleteExperiment={selectedPageId ? async (experimentId) => {
                  setExperiments(prev => prev.filter(e => e.id !== experimentId))
                  setCreativeLabels(prev => {
                    const n = { ...prev }
                    for (const k of Object.keys(n)) if (n[k].experimentId === experimentId) delete n[k]
                    return n
                  })
                  await fetch('/api/ads/experiments', { method: 'POST', headers: { Authorization: `Bearer ${idTokenRef}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: selectedPageId, action: 'delete', experimentId }) })
                } : undefined}
              />}
              {active === 'trends' && <CreativeTrendsSection trends={adData.creativeTrends ?? []} dateFrom={dateFrom} dateTo={dateTo} conversionType={adData.conversionType} experiments={experiments} creativeLabels={creativeLabels} />}
              {active === 'audience' && <AudienceSection demographics={adData.demographics ?? []} funnelStages={adData.funnelStages ?? []} conversionType={adData.conversionType} />}
              {active === 'posts' && <PostsSection onAskAI={canSidekick ? openSidekick : undefined} posts={realPosts ? realPosts.filter(p => p.date >= dateFrom && p.date <= dateTo) : null} />}
              {active === 'time' && <BestTimeSection data={adData} />}
              {active === 'budget' && <BudgetSection data={adData} creativeLabels={creativeLabels} experiments={experiments} />}
            </>
          )}
        </main>
      </div>

      {/* FAB */}
      {canSidekick && <button className={`ads-sk-fab ${skOpen ? 'hidden' : ''}`} onClick={() => openSidekick()} title="AI Sidekick">✨</button>}

      {/* AI Sidekick Drawer */}
      {canSidekick && <AiSidekick
        open={skOpen}
        onClose={() => setSkOpen(false)}
        contextPage={active}
        initialPrompt={skInitPrompt}
        autoSendPrompt={skAutoSend ? skInitPrompt : undefined}
        pageId={selectedPageId || undefined}
        metricsContext={{
          spend: adData.overview.summary.spend,
          roas: adData.overview.summary.roas,
          cpa: adData.overview.summary.cpa,
          ctr: adData.overview.summary.ctr,
          cpm: adData.overview.summary.cpm,
          impressions: adData.overview.summary.impressions,
          frequency: adData.overview.summary.frequency,
          conversions: adData.overview.summary.conversions,
          revenue: adData.overview.summary.revenue,
          dateRange: adData.overview.dateRange,
          topCreatives: adData.creatives.slice(0, 5).map(c => ({
            name: c.name, roas: c.roas, spend: c.spend, ctr: Number(c.ctr), cpa: c.cpa,
          })),
        }}
      />}
    </div>
  )
}
