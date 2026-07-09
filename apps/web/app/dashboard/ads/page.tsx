'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { MOCK_DATA } from '@/components/ads/mockData'
import { mapRawAdCreative, buildDiagnosis } from '@/lib/ads/diagnosis'
import { buildContentDiagnosis } from '@/lib/ads/contentDiagnosis'
import { Icon } from '@/components/ads/Icon'
import { AiSidekick } from '@/components/ads/AiSidekick'
import { OverviewSection } from '@/components/ads/sections/OverviewSection'
import { DiagnosisSection, type CardStatus } from '@/components/ads/sections/DiagnosisSection'
import { CreativeSection } from '@/components/ads/sections/CreativeSection'
import { BrandAssetsCard } from '@/components/analytics/BrandAssetsCard'
import { CreativeTrendsSection } from '@/components/ads/sections/CreativeTrendsSection'
import { AudienceSection } from '@/components/ads/sections/AudienceSection'
import { PostsSection } from '@/components/ads/sections/PostsSection'
import { BestTimeSection } from '@/components/ads/sections/BestTimeSection'
import { BudgetSection } from '@/components/ads/sections/BudgetSection'
import { InsightsSection } from '@/components/ads/sections/InsightsSection'
import type { NavId, Post, AdData, LabelEntry, Experiment, DiagItem, AiDiagCard } from '@/components/ads/types'
import { useLang, type Lang } from '@/lib/i18n/LanguageProvider'
import { DateField } from '@/components/ui/DateField'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { trackEvent } from '@/lib/analytics/track'

const NAV: { id: NavId; icon: string; badge?: string }[] = [
  { id: 'overview', icon: 'chart' },
  { id: 'insights', icon: 'chart' },
  { id: 'diagnosis', icon: 'alert' },
  { id: 'creative', icon: 'creative' },
  { id: 'brand', icon: 'creative' },
  { id: 'trends', icon: 'chart' },
  { id: 'audience', icon: 'chart' },
  { id: 'posts', icon: 'calendar' },
  { id: 'time', icon: 'clock' },
  { id: 'budget', icon: 'budget' },
]

const NAV_LABELS: Record<NavId, { zh: string; en: string }> = {
  overview: { zh: '總覽', en: 'Overview' },
  insights: { zh: '洞察報告', en: 'Insights' },
  diagnosis: { zh: '診斷建議', en: 'Diagnosis' },
  creative: { zh: '素材績效排行', en: 'Creative Ranking' },
  brand: { zh: '品牌素材庫', en: 'Brand Assets' },
  trends: { zh: '成效趨勢', en: 'Trends' },
  audience: { zh: '受眾分析', en: 'Audience' },
  posts: { zh: '內容表現', en: 'Content' },
  time: { zh: '最佳時段', en: 'Best Time' },
  budget: { zh: '預算模擬', en: 'Budget' },
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
    title: p.message || '(no text)',
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
    title: p.caption || '(no text)',
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
function buildAdData(raw: any, lang: Lang = 'zh-TW'): AdData {
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
  const diagnosis = buildDiagnosis(s as Record<string, number>, realCreatives ? creatives : [], realBudget, lang === 'en')

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
  const DAY_NAMES = lang === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
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
    deviceBreakdown: Array.isArray(raw.deviceBreakdown) ? raw.deviceBreakdown : [],
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

function formatRelativeTime(isoString: string, lang: Lang = 'zh-TW'): string {
  const en = lang === 'en'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return en ? 'just now' : '剛剛'
  if (mins < 60) return en ? `${mins} min ago` : `${mins} 分鐘前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return en ? `${hrs} hr ago` : `${hrs} 小時前`
  return en ? `${Math.floor(hrs / 24)} d ago` : `${Math.floor(hrs / 24)} 天前`
}

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000

export default function AdsPage() {
  const router = useRouter()
  const { L, lang } = useLang()
  const [authed, setAuthed] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  // Deep link: ?section=diagnosis opens that nav section directly (from the alert
  // email「查看 AI 診斷」button and the 鈴鐺 notification deepLink).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = new URLSearchParams(window.location.search).get('section')
    if (s && NAV.some(n => n.id === s)) setActive(s as NavId)
  }, [])
  // The ads dashboard is a single route with client-side nav sections, so GA sees
  // one pageview. Emit a section_view event on each section so per-section usage
  // (洞察報告 / 診斷 / 素材…) is measurable.
  useEffect(() => { trackEvent('section_view', { section: active }) }, [active])
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
  const [aiDiagCards, setAiDiagCards] = useState<AiDiagCard[] | null>(null)
  const aiDiagSig = useRef('')
  const [cardStatuses, setCardStatuses] = useState<Record<string, CardStatus>>({})

  // Mark / skip / reopen a diagnosis card. Optimistic update + persist (page-level,
  // admin only — viewers don't get the buttons).
  const handleCardAction = useCallback(async (cardKey: string, status: CardStatus | 'open', meta?: { severityRank?: number; output?: string; context?: string; alertType?: string }) => {
    setCardStatuses(prev => {
      const next = { ...prev }
      if (status === 'open') delete next[cardKey]
      else next[cardKey] = status
      return next
    })
    const u = auth.currentUser
    if (!u || !selectedPageId) return
    const idToken = await u.getIdToken()
    try {
      await fetch('/api/ads/diagnosis-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: selectedPageId, cardKey, status,
          severityRank: meta?.severityRank, output: meta?.output, context: meta?.context,
          alertType: meta?.alertType, goal: optimizationGoal ?? undefined,
        }),
      })
    } catch { /* optimistic state already applied */ }
  }, [selectedPageId, optimizationGoal])

  // Ad + content diagnosis (Layer 1) for the current date range. Memoized so the
  // Agent fetch effect and the render share one stable array.
  const diagnosisItems = useMemo<DiagItem[]>(() => {
    const filteredPosts = (realPosts ?? []).filter(p => p.date >= dateFrom && p.date <= dateTo)
    const contentDiag = buildContentDiagnosis(filteredPosts, { cpm: adData.overview.summary.cpm }, lang === 'en')
    const adDiag = contentDiag.length > 0 ? adData.diagnosis.filter(d => d.id !== 'd0') : adData.diagnosis
    return [...adDiag, ...contentDiag]
  }, [adData, realPosts, dateFrom, dateTo])

  // Layer 2: ask the Agent to rewrite the findings into Madgicx-style cards. Only
  // fires on the diagnosis tab, deduped by a content signature, cleared on change
  // so cards never leak across pages/date-ranges. Server caches by fingerprint.
  useEffect(() => {
    if (active !== 'diagnosis' || !selectedPageId || diagnosisItems.length === 0) return
    const sig = diagnosisItems.map(d => `${d.id}|${d.severity}|${d.metric}|${d.desc}`).join('||')
    if (sig === aiDiagSig.current) return
    aiDiagSig.current = sig
    setAiDiagCards(null)
    let cancelled = false
    ;(async () => {
      const u = auth.currentUser
      if (!u) return
      const idToken = await u.getIdToken()
      try {
        const res = await fetch('/api/ai/diagnosis', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: selectedPageId, items: diagnosisItems, summary: adData.overview.summary, language: lang }),
        })
        const json = await res.json()
        if (!cancelled && Array.isArray(json.cards)) setAiDiagCards(json.cards)
      } catch { /* keep rule-template fallback */ }
    })()
    return () => { cancelled = true }
  }, [active, selectedPageId, diagnosisItems, adData])

  // Load per-card Open/Completed/Dismissed statuses (page-level shared). Cleared on
  // page switch so statuses never leak across pages.
  useEffect(() => {
    if (active !== 'diagnosis' || !selectedPageId) return
    setCardStatuses({})
    let cancelled = false
    ;(async () => {
      const u = auth.currentUser
      if (!u) return
      const idToken = await u.getIdToken()
      try {
        const res = await fetch(`/api/ads/diagnosis-status?pageId=${selectedPageId}`, { headers: { Authorization: `Bearer ${idToken}` } })
        const json = await res.json()
        if (!cancelled && json.statuses) setCardStatuses(json.statuses)
      } catch { /* no statuses → all open */ }
    })()
    return () => { cancelled = true }
  }, [active, selectedPageId])

  type AdMetricsMap = Record<string, { spend: number; roas: number; cpa: number; ctr: number; reach?: number }>
  async function fetchAdData(idToken: string, pageId?: string): Promise<{ adPostIds: Set<string>; adPostMetrics: AdMetricsMap; igPostIds: Set<string>; igPostMetrics: AdMetricsMap }> {
    const pid = pageId ?? selectedPageId
    const qs = pid ? `?pageId=${pid}` : ''
    const res = await fetch(`/api/ads/data${qs}`, { headers: { Authorization: `Bearer ${idToken}` } })
    if (!res.ok) return { adPostIds: new Set(), adPostMetrics: {}, igPostIds: new Set(), igPostMetrics: {} }
    const json = await res.json()
    if (json.data) {
      setAdData(buildAdData(json.data, lang))
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
          // Permissions are page-scoped. A user can be admin on page A and viewer on page B.
          const activePage = allPages.find(p => p.pageId === pageId) ?? allPages[0]
          const activeIsManager = activePage?.permissions === undefined || activePage?.permissions === null
          if (activeIsManager) {
            setCanSidekick(true)
            setCanSync(true)
          } else {
            if (!activePage?.permissions?.ads) {
              router.replace('/dashboard')
              return
            }
            setCanSidekick(!!activePage.permissions.sidekick)
            setCanSync(!!activePage.permissions.syncAds)
          }
        }
        if (pageId) {
          const roleRes = await fetch(`/api/user/role?pageId=${pageId}`, { headers })
          if (roleRes.ok) {
            const roleJson = await roleRes.json()
            const caps: string[] = Array.isArray(roleJson.capabilities) ? roleJson.capabilities : []
            setCanSidekick(caps.includes('sidekick.use'))
            setCanSync(caps.includes('data.sync'))
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
          setAdData(buildAdData(adJson.data, lang))
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

  // NOTE: intentionally do NOT sync the picker to adData.overview.dateRange —
  // the overview should always default to the last 30 days (today → 30 days ago),
  // per the initial dateFrom/dateTo state. Users can still pick other ranges.

  async function handleSync(since?: string, until?: string) {
    trackEvent('sync_clicked', { context: 'ads' })
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
      if (!res.ok) { setSyncError(json.error ?? L('同步失敗', 'Sync failed')); return }
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
          if (!igSyncRes.ok) console.warn('[ig sync]', igJson.error ?? 'unknown error')
          const fbSyncJson = await fbSyncRes.json()
          if (!fbSyncRes.ok) console.warn('[fb sync]', fbSyncJson.error ?? 'unknown error')
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
      setSyncError(e instanceof Error ? e.message : L('同步失敗', 'Sync failed'))
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
      setAdData(buildAdData(adJson.data, lang))
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
    trackEvent('sidekick_opened', { context: 'ads', auto: autoSend })
    setSkInitPrompt(prompt)
    setSkAutoSend(autoSend)
    setSkOpen(true)
  }, [])

  function exportJSON() {
    trackEvent('report_exported', { format: 'json' })
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
    trackEvent('report_exported', { format: 'csv' })
    const s = adData.overview.summary
    const lines: string[] = []
    const row = (...cols: (string | number | undefined)[]) =>
      lines.push(cols.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))

    row(L('整體指標', 'Overall metrics'), '')
    row(L('指標', 'Metric'), L('數值', 'Value'))
    row(L('日期範圍', 'Date range'), `${dateFrom} ~ ${dateTo}`)
    row(L('總花費', 'Total spend'), s.spend ?? 0)
    row(L('CPL (點擊成本)', 'CPL (cost per link click)'), s.cpa ?? 0)
    row('CTR (%)', s.ctr ?? 0)
    row('CPA', s.cpa ?? 0)
    row(L('總觸及', 'Total reach'), s.reach ?? 0)
    row(L('頻率', 'Frequency'), s.frequency ?? 0)
    lines.push('')

    row(L('素材績效', 'Creative performance'), '', '', '', '', '')
    row(L('名稱', 'Name'), L('花費', 'Spend'), L('點擊效益', 'Click value'), 'CTR(%)', 'CPL', L('狀態', 'Status'))
    adData.creatives.forEach(c => row(c.name, c.spend, c.roas, c.ctr, c.cpa, c.status))
    lines.push('')

    row(L('每日花費', 'Daily spend'), '', '', '')
    row(L('日期', 'Date'), L('花費', 'Spend'), L('點擊數', 'Clicks'), L('點擊效益', 'Click value'))
    adData.overview.dailySpend?.forEach(d => row(d.date, d.spend, d.revenue, d.roas))
    lines.push('')

    row(L('診斷項目', 'Diagnosis items'), '', '', '')
    row(L('嚴重度', 'Severity'), L('標題', 'Title'), L('描述', 'Description'), L('建議行動', 'Recommended action'))
    adData.diagnosis.forEach(d => row(d.severity, d.title, d.desc, d.action))
    lines.push('')

    row(L('內容表現', 'Content performance'), '', '', '', '', '', '', '', '', '', '', '', '')
    row(L('日期', 'Date'), L('平台', 'Platform'), L('類型', 'Type'), L('標題', 'Title'), L('觸及', 'Reach'), L('自然觸及', 'Organic reach'), L('付費觸及', 'Paid reach'), L('按讚', 'Likes'), L('留言', 'Comments'), L('收藏', 'Saves'), L('分享', 'Shares'), L('播放', 'Plays'), L('互動率(%)', 'Engagement(%)'), L('有廣告', 'Has ad'), L('廣告花費', 'Ad spend'), L('廣告CPL', 'Ad CPL'), L('廣告CTR(%)', 'Ad CTR(%)'))
    ;(realPosts ?? []).filter(p => p.date >= dateFrom && p.date <= dateTo).forEach(p => {
      const er = (p.reach && p.reach > 0)
        ? ((p.likes + p.comments + p.shares) / p.reach * 100).toFixed(2)
        : ''
      row(p.date, p.platform, p.type, p.title, p.reach ?? '', p.organicReach ?? '', p.paidReach ?? '', p.likes, p.comments, p.saves ?? '', p.shares, p.plays ?? '', er, p.hasAd ? L('是', 'Yes') : L('否', 'No'), p.adSpend ?? '', p.adRoas ?? '', p.adCpa ?? '', p.adCtr ?? '')
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
        <LoadingScreen />
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
              <div className="sub">{L('廣告儀表板', 'Ad Dashboard')}</div>
            </button>
          ) : (
            <>
              <div className="brand" style={{ fontSize: 13 }}>{selectedPageName || 'ContentLoop'}</div>
              <div className="sub">{L('廣告儀表板', 'Ad Dashboard')}</div>
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
          <div className="ads-nav-section">{L('主要功能', 'Main')}</div>
          {NAV.map(item => (
            <div key={item.id} className={`ads-nav-item ${active === item.id ? 'active' : ''}`} onClick={() => setActive(item.id)}>
              <Icon name={item.icon} size={15} color={active === item.id ? 'var(--ad-blue)' : 'var(--ad-text3)'} />
              {NAV_LABELS[item.id][lang === 'en' ? 'en' : 'zh']}
              {item.badge && <span className="ads-nav-badge">{item.badge}</span>}
            </div>
          ))}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>{L('頻道', 'Channels')}</div>
          {[['Meta', '#888'], ['Facebook', '#1877F2'], ['Instagram', '#E1306C']].map(([l, c]) => (
            <div key={l} className="ads-nav-item" style={{ paddingLeft: 14, cursor: 'default' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c, width: 16, display: 'inline-block' }}>{l[0]}</span>
              {l}
            </div>
          ))}
          {canSidekick && (
            <>
              <div className="ads-nav-section" style={{ marginTop: 8 }}>{L('AI 助手', 'AI Assistant')}</div>
              <div className="ads-nav-sk-btn" onClick={() => openSidekick()}>
                <span style={{ fontSize: 18 }}>✨</span>
                <div>
                  <div className="sk-label">AI Sidekick</div>
                  <div className="sk-sub">{L('問我任何廣告問題', 'Ask me anything about ads')}</div>
                </div>
              </div>
            </>
          )}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>{L('導覽', 'Navigation')}</div>
          <div className="ads-nav-item" onClick={() => router.push('/dashboard/links')}>
            <Icon name="ads" size={15} color="var(--ad-text3)" />
            🔗 {L('報名連結追蹤', 'Link tracking')}
          </div>
          <div className="ads-nav-item" onClick={() => router.push('/dashboard')}>
            <Icon name="ads" size={15} color="var(--ad-text3)" />
            {L('← 回內容儀表板', '← Back to content')}
          </div>
        </div>
        <div className="ads-nav-footer">
          <div>{L('最後更新', 'Last updated')}</div>
          <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11 }}>
            {lastSync ? formatRelativeTime(lastSync, lang) : L('— 尚未同步', '— not synced')}
          </div>
        </div>
      </nav>

      {/* Main area */}
      <div className={`ads-main ${skOpen ? 'sk-open' : ''}`}>
        <header className="ads-topbar">
          <span className="ads-topbar-title">{NAV_LABELS[active][lang === 'en' ? 'en' : 'zh']}</span>
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ad-text2)', marginBottom: 10 }}>{L('自訂日期範圍', 'Custom date range')}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <DateField value={dateFrom} max={dateTo} onChange={setDateFrom}
                      style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--ad-border)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)' }} />
                    <span style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('至', 'to')}</span>
                    <DateField value={dateTo} min={dateFrom} max={new Date().toISOString().slice(0, 10)} onChange={setDateTo}
                      style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--ad-border)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {([[L('近 7 天', 'Last 7d'), 7], [L('近 14 天', 'Last 14d'), 14], [L('近 30 天', 'Last 30d'), 30]] as [string, number][]).map(([label, days]) => (
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
                    {L('套用並同步資料', 'Apply & sync')}
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
            {syncing ? L('同步中⋯', 'Syncing…') : syncError ? `⚠ ${syncError}` : L('↻ 同步最新資料', '↻ Sync latest data')}
          </button>}
          <div style={{ position: 'relative' }}>
            <button className="ads-btn primary" onClick={() => setShowExportMenu(p => !p)}>
              <Icon name="download" size={13} color="white" />{L('匯出報告 ▾', 'Export ▾')}
            </button>
            {showExportMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowExportMenu(false)} />
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'white', border: '1px solid var(--ad-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 148, overflow: 'hidden' }}>
                  <button style={{ display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }} onClick={exportJSON}>📦 {L('匯出 JSON', 'Export JSON')}</button>
                  <button style={{ display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }} onClick={exportCSV}>📊 {L('匯出 CSV', 'Export CSV')}</button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="ads-content">
          {!dataLoaded ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
              <LoadingScreen />
            </div>
          ) : (
            <>
              {active === 'overview' && <OverviewSection data={adData} onAskAI={canSidekick ? openSidekick : undefined} posts={realPosts} optimizationGoal={optimizationGoal} />}
              {active === 'insights' && <InsightsSection pageId={selectedPageId} onAskAI={canSidekick ? openSidekick : undefined} />}
              {active === 'diagnosis' && <DiagnosisSection
                data={{ ...adData, diagnosis: diagnosisItems }}
                posts={realPosts}
                aiCards={aiDiagCards}
                cardStatuses={cardStatuses}
                canManage={canSync}
                onCardAction={handleCardAction}
                onAskAI={canSidekick ? openSidekick : undefined}
              />}
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
              {active === 'brand' && selectedPageId && idTokenRef && <BrandAssetsCard pageId={selectedPageId} idToken={idTokenRef} />}
              {active === 'trends' && <CreativeTrendsSection trends={adData.creativeTrends ?? []} dateFrom={dateFrom} dateTo={dateTo} conversionType={adData.conversionType} experiments={experiments} creativeLabels={creativeLabels} />}
              {active === 'audience' && <AudienceSection demographics={adData.demographics ?? []} funnelStages={adData.funnelStages ?? []} deviceBreakdown={adData.deviceBreakdown ?? []} conversionType={adData.conversionType} />}
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
