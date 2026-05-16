'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { MOCK_DATA } from '@/components/ads/mockData'
import { Icon } from '@/components/ads/Icon'
import { AiSidekick } from '@/components/ads/AiSidekick'
import { OverviewSection } from '@/components/ads/sections/OverviewSection'
import { DiagnosisSection } from '@/components/ads/sections/DiagnosisSection'
import { CreativeSection } from '@/components/ads/sections/CreativeSection'
import { PostsSection } from '@/components/ads/sections/PostsSection'
import { BestTimeSection } from '@/components/ads/sections/BestTimeSection'
import { BudgetSection } from '@/components/ads/sections/BudgetSection'
import type { NavId, Post, AdData, DiagItem } from '@/components/ads/types'

const NAV: { id: NavId; label: string; icon: string; badge?: string }[] = [
  { id: 'overview', label: '總覽', icon: 'chart' },
  { id: 'diagnosis', label: '診斷建議', icon: 'alert' },
  { id: 'creative', label: '素材庫', icon: 'creative' },
  { id: 'posts', label: '內容表現', icon: 'calendar' },
  { id: 'time', label: '最佳時段', icon: 'clock' },
  { id: 'budget', label: '預算模擬', icon: 'budget' },
]

const NAV_LABELS: Record<NavId, string> = {
  overview: '總覽', diagnosis: '診斷建議', creative: '素材庫',
  posts: '內容表現', time: '最佳時段', budget: '預算模擬',
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
    paidReach: p.insights?.paidReach ?? 0,
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

function inferCreativeType(name: string): string {
  if (/reels/i.test(name)) return 'Reels'
  if (/stories|story/i.test(name)) return 'Stories'
  if (/海報/.test(name)) return '海報'
  return '貼文'
}
function inferThumb(type: string): 'reels' | 'post' | 'stories' | 'poster' {
  if (type === 'Reels') return 'reels'
  if (type === 'Stories') return 'stories'
  if (type === '海報') return 'poster'
  return 'post'
}
function inferStatus(roas: number): 'top' | 'good' | 'ok' | 'bad' {
  if (roas >= 4) return 'top'
  if (roas >= 3) return 'good'
  if (roas >= 1.5) return 'ok'
  return 'bad'
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawAdCreative(c: any, idx: number) {
  const spend = parseFloat(c.spend ?? '0')
  const impressions = parseInt(c.impressions ?? '0')
  const ctr = parseFloat(c.ctr ?? '0')
  const actions: { action_type: string; value: string }[] = c.actions ?? []
  const actionValues: { action_type: string; value: string }[] = c.action_values ?? []
  const purchases = parseFloat(actions.find(a => a.action_type === 'purchase')?.value ?? '0')
  const linkClicks = parseFloat(actions.find(a => a.action_type === 'link_click')?.value ?? '0')
  const videoViews = parseFloat(actions.find(a => a.action_type === 'video_view')?.value ?? '0')
  const revenue = parseFloat(actionValues.find(a => a.action_type === 'purchase')?.value ?? '0')
  const hasPurchase = purchases > 0
  const primaryMetric = hasPurchase ? revenue : linkClicks > 0 ? linkClicks : videoViews
  // For non-revenue accounts (e.g. D67 non-profit), ROAS is meaningless.
  // Instead, compute a "Click Efficiency Score" = link_clicks / spend * 100
  // which represents "how many clicks per $1 spent × 100".
  // If purchases exist, use real ROAS. Otherwise use click efficiency score.
  const clickEfficiency = spend > 0 && linkClicks > 0
    ? parseFloat((linkClicks / spend * 100).toFixed(2))
    : 0
  const roas = spend > 0 && primaryMetric > 0
    ? (hasPurchase
        ? parseFloat((primaryMetric / spend).toFixed(2))   // Real ROAS for e-commerce
        : clickEfficiency)                                  // Click efficiency score for non-profit
    : 0
  const cpa = primaryMetric > 0 ? parseFloat((spend / primaryMetric).toFixed(2)) : 0
  const postTitle = c.post_title ? (c.post_title as string).slice(0, 60) : null
  const type = inferCreativeType(c.ad_name ?? '')
  return {
    id: c.ad_id ?? String(idx),
    name: postTitle ?? c.ad_name ?? `廣告 ${idx + 1}`,
    type,
    channel: 'Meta',
    spend,
    impressions,
    ctr,
    roas,
    cpa,
    thumb: inferThumb(type),
    status: inferStatus(roas),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDiagnosis(s: Record<string, number>, creatives: ReturnType<typeof mapRawAdCreative>[], budget: number): DiagItem[] {
  const items: DiagItem[] = []

  if ((s.frequency ?? 0) > 3.5) {
    items.push({ id: 'd1', severity: 'critical', type: 'audience_fatigue', title: '受眾疲乏警告',
      desc: `整體帳戶頻率已達 ${(s.frequency).toFixed(2)}，建議暫停或更換素材。`,
      adset: '整體帳戶', metric: `Frequency ${(s.frequency).toFixed(2)}`, threshold: '> 3.5', action: '更換素材 / 擴大受眾' })
  }

  // For non-profit accounts (no revenue): skip ROAS warning entirely.
  // Instead, warn if CPL (cost per link click) is high (> $10 per click).
  const cpl = (s.conversions ?? 0) > 0 ? (s.spend ?? 0) / (s.conversions ?? 1) : 0
  if ((s.spend ?? 0) > 0 && (s.conversions ?? 0) === 0) {
    items.push({ id: 'd2', severity: 'warning', type: 'low_roas', title: '尚無點擊轉換數據',
      desc: '目前未偵測到報名連結點擊數據，建議確認廣告目標是否設為「流量」或「互動」。',
      adset: '整體帳戶', metric: '轉換數 0', threshold: '需 > 0', action: '檢查廣告目標設定 / 確認連結正確' })
  } else if (cpl > 10 && (s.spend ?? 0) > 0) {
    items.push({ id: 'd2', severity: 'warning', type: 'low_roas', title: 'CPL 偏高',
      desc: `每次點擊報名連結成本為 $${cpl.toFixed(2)}，建議優化素材或縮小受眾。`,
      adset: '整體帳戶', metric: `CPL $${cpl.toFixed(2)}`, threshold: '建議 < $10', action: '優化 CTA 文案 / 縮小受眾' })
  }

  const budgetPct = budget > 0 ? (s.spend / budget) * 100 : 0
  if (budgetPct > 80) {
    items.push({ id: 'd3', severity: budgetPct > 95 ? 'critical' : 'warning', type: 'budget', title: '預算超支風險',
      desc: `目前花費進度 ${budgetPct.toFixed(1)}%，需注意月底前燒速。`,
      adset: '整體帳戶', metric: `已花 $${Math.round(s.spend).toLocaleString('zh-TW')}`,
      threshold: `預算 $${Math.round(budget).toLocaleString('zh-TW')}`, action: budgetPct > 95 ? '立即暫停低效組合' : '維持現況，每日監控' })
  }

  const lowCtr = creatives.find(c => c.ctr > 0 && c.ctr < 1.5 && c.spend > 0)
  if (lowCtr) {
    items.push({ id: 'd4', severity: 'warning', type: 'low_ctr', title: 'CTR 偏低素材',
      desc: `素材「${lowCtr.name.slice(0, 25)}」CTR 僅 ${lowCtr.ctr.toFixed(2)}%，低於建議值 1.5%。`,
      adset: lowCtr.name.slice(0, 30), metric: `CTR ${lowCtr.ctr.toFixed(2)}%`, threshold: '< 1.5%', action: '更換廣告文案或素材' })
  } else if ((s.ctr ?? 0) > 0 && (s.ctr) < 1.5) {
    items.push({ id: 'd4', severity: 'warning', type: 'low_ctr', title: 'CTR 偏低',
      desc: `整體 CTR 僅 ${(s.ctr).toFixed(2)}%，低於建議值 1.5%。`,
      adset: '整體帳戶', metric: `CTR ${(s.ctr).toFixed(2)}%`, threshold: '< 1.5%', action: '更換廣告文案或素材' })
  }

  const top = [...creatives].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas)[0]
  if (top && top.roas >= 5) {
    items.push({ id: 'd5', severity: 'good', type: 'top_performer', title: '最佳點擊效率素材',
      desc: `素材「${top.name.slice(0, 25)}」點擊效率達 ${top.roas.toFixed(1)}x，建議增加預算。`,
      adset: top.name.slice(0, 30), metric: `點擊效率 ${top.roas.toFixed(1)}`, threshold: '目標 > 5', action: `增加預算 20-30%` })
  }

  if (items.length === 0) {
    items.push({ id: 'd0', severity: 'good', type: 'top_performer', title: '帳戶表現良好',
      desc: `CTR ${(s.ctr ?? 0).toFixed(2)}%，點擊效益正常，各項指標正常。`,
      adset: '整體帳戶', metric: `CTR ${(s.ctr ?? 0).toFixed(2)}%`, threshold: '正常', action: '持續監控，維持現況' })
  }

  return items
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAdData(raw: any): AdData {
  const s = raw.summary ?? {}
  const from = raw.dateRange?.from ?? ''
  const to = raw.dateRange?.to ?? ''
  const creatives = Array.isArray(raw.adCreatives)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.adCreatives.map((c: any, i: number) => mapRawAdCreative(c, i))
    : []
  const budget = MOCK_DATA.overview.summary.budget
  const realCreatives = creatives.length > 0
  const diagnosis = buildDiagnosis(s as Record<string, number>, realCreatives ? creatives : [], budget)

  // Real adsets from per-creative data
  const realAdsets = realCreatives
    ? creatives.map((c: ReturnType<typeof mapRawAdCreative>) => ({
        name: c.name,
        budget: c.spend > 0 ? Math.round(c.spend / 0.8) : 1000,
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

export default function AdsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')
  const [skAutoSend, setSkAutoSend] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10)
  })
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
  const [creativeLabels, setCreativeLabels] = useState<Record<string, 'A' | 'B' | 'control'>>({})
  const [idTokenRef, setIdTokenRef] = useState('')

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
        const pageId = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : '') ?? ''
        const pageName = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageName') : '') ?? ''
        setSelectedPageId(pageId)
        setSelectedPageName(pageName)

        // Load all managed pages and check permission
        const pagesRes = await fetch('/api/pages', { headers })
        if (pagesRes.ok) {
          const pagesJson = await pagesRes.json()
          const allPages: Array<{ pageId: string; pageName: string; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } | null }> = pagesJson.pages ?? []
          setPages(allPages)
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
          const labelsRes = await fetch(`/api/ads/labels?pageId=${pageId}`, { headers })
          if (labelsRes.ok) {
            const labelsJson = await labelsRes.json()
            setCreativeLabels(labelsJson.labels ?? {})
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
          const igRes = await fetch('/api/insights/ig/sync', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId: selectedPageId }),
          })
          const igJson = await igRes.json()
          if (!igRes.ok) console.warn('[ig sync]', igJson.error ?? '未知錯誤')
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
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : '同步失敗')
    } finally {
      setSyncing(false)
    }
  }

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
            {lastSync ? new Date(lastSync).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '— 尚未同步'}
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
              {active === 'overview' && <OverviewSection data={adData} onAskAI={canSidekick ? openSidekick : undefined} posts={realPosts} />}
              {active === 'diagnosis' && <DiagnosisSection data={adData} onAskAI={canSidekick ? openSidekick : undefined} />}
              {active === 'creative' && <CreativeSection data={adData} onAskAI={canSidekick ? openSidekick : undefined} creativeLabels={creativeLabels} onLabelChange={selectedPageId ? async (adId, variant) => {
                setCreativeLabels(prev => {
                  if (variant === null) { const n = { ...prev }; delete n[adId]; return n }
                  return { ...prev, [adId]: variant }
                })
                await fetch('/api/ads/labels', { method: 'POST', headers: { Authorization: `Bearer ${idTokenRef}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: selectedPageId, adId, variant }) })
              } : undefined} />}
              {active === 'posts' && <PostsSection onAskAI={canSidekick ? openSidekick : undefined} posts={realPosts} />}
              {active === 'time' && <BestTimeSection data={adData} />}
              {active === 'budget' && <BudgetSection data={adData} />}
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
