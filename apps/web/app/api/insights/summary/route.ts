export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { BENCHMARKS, getBenchmarkByGoal } from '@/lib/benchmarks'

// Period helpers
function getPeriodRange(year: number, periodType: 'month' | 'quarter', value: number): {
  start: Date; end: Date; label: string; isPartial: boolean; periodKey: string
} {
  const now = new Date()
  if (periodType === 'month') {
    const start = new Date(year, value - 1, 1)
    const fullEnd = new Date(year, value, 0, 23, 59, 59)
    const isPartial = now < fullEnd
    return { start, end: isPartial ? now : fullEnd, label: `${year}年${value}月`, isPartial, periodKey: `${year}-${String(value).padStart(2, '0')}` }
  }
  const QUARTER_LABELS = ['', '1-3月', '4-6月', '7-9月', '10-12月']
  const qStartMonth = (value - 1) * 3
  const start = new Date(year, qStartMonth, 1)
  const fullEnd = new Date(year, qStartMonth + 3, 0, 23, 59, 59)
  const isPartial = now < fullEnd
  return { start, end: isPartial ? now : fullEnd, label: `${year} Q${value}（${QUARTER_LABELS[value]}）`, isPartial, periodKey: `${year}-Q${value}` }
}

// Handle both Firestore Timestamp and ISO string date
const tsMillis = (v: unknown): number => {
  if (v && typeof (v as Record<string, unknown>).toMillis === 'function') {
    return (v as { toMillis(): number }).toMillis()
  }
  if (typeof v === 'string') { const ms = Date.parse(v); return isNaN(ms) ? 0 : ms }
  return 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeInsights(a: unknown, b: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const src of [a, b]) {
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v === 'number') out[k] = Math.max(out[k] ?? 0, v)
      }
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  const now = new Date()
  const periodType = (req.nextUrl.searchParams.get('periodType') ?? 'month') as 'month' | 'quarter'
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(now.getFullYear()))
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? String(now.getMonth() + 1))
  const quarter = parseInt(req.nextUrl.searchParams.get('quarter') ?? String(Math.ceil((now.getMonth() + 1) / 3)))

  // Resolve data owner
  let dataOwnerUid = uid
  if (pageId) {
    const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
    if (!ownTokenSnap.exists) {
      const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
      const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
      const allowed = viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const ownerUid = await resolvePageOwnerUid(pageId)
      if (!ownerUid) return NextResponse.json({ error: 'Page not found' }, { status: 404 })
      dataOwnerUid = ownerUid
    }
  }

  const { start, end, label, isPartial, periodKey } = getPeriodRange(year, periodType, periodType === 'month' ? month : quarter)
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  // --- Read page profile (optimizationGoal, industry) ---
  const [profileSnap, adsSnap] = await Promise.all([
    adminDb.collection('pages').doc(pageId).get(),
    adminDb.collection('users').doc(dataOwnerUid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get(),
  ])
  const profile = profileSnap.data() ?? {}
  const optimizationGoal = (profile.optimizationGoal ?? 'clicks') as string
  const industry = (profile.industry ?? 'event') as string

  // --- Fetch FB posts: both page-scoped (live sync) + legacy (CSV/MD import) ---
  const [newSnap, legacySnap] = await Promise.all([
    userRef.collection('pages').doc(pageId).collection('fbPosts').orderBy('createdTime', 'desc').limit(500).get(),
    userRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(500).get(),
  ])

  const byId = new Map<string, Record<string, unknown>>()
  for (const d of newSnap.docs) byId.set(d.id, d.data())
  for (const d of legacySnap.docs) {
    if (!d.id.startsWith(`${pageId}_`)) continue
    const legacy = d.data()
    const base = byId.get(d.id)
    if (!base) { byId.set(d.id, legacy); continue }
    byId.set(d.id, { ...legacy, ...base, insights: mergeInsights(base.insights, legacy.insights) })
  }

  const fbPosts = Array.from(byId.entries())
    .map(([id, data]) => ({ id, ...data }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => {
      const ms = tsMillis(p.createdTime)
      return ms > 0 && ms >= start.getTime() && ms <= end.getTime()
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => {
      const reach = p.insights?.reach ?? 0
      const reactions = p.insights?.reactions ?? 0
      const comments = p.insights?.comments ?? 0
      const shares = p.insights?.shares ?? 0
      const engRate = reach > 0 ? Number(((reactions + comments + shares) / reach * 100).toFixed(2)) : 0
      const createdTime = p.createdTime?.toDate?.()?.toISOString?.() ?? (typeof p.createdTime === 'string' ? p.createdTime : '')
      return {
        id: p.id,
        message: (p.message ?? '').slice(0, 120),
        createdTime,
        reach,
        reactions,
        comments,
        shares,
        saves: p.insights?.saves ?? 0,
        permalink: p.permalink ?? '',
        engRate,
      }
    })
    .filter(p => typeof p.message === 'string' && p.message.trim().length > 0)

  // --- Follower stats ---
  const statsSnap = await userRef.collection('pages').doc(pageId).collection('pageStats').get()
  const followerStats = statsSnap.docs
    .map(d => ({ date: d.data().date ?? d.id, total: d.data().total ?? 0, net: d.data().net ?? 0 }))
    .filter(s => s.date >= start.toISOString().slice(0, 10) && s.date <= end.toISOString().slice(0, 10))
  const followerGrowth = followerStats.reduce((sum, s) => sum + s.net, 0)
  const latestFollowers = followerStats[followerStats.length - 1]?.total ?? 0
  const followerGrowthRate = latestFollowers > 0 ? Number((followerGrowth / latestFollowers * 100).toFixed(2)) : 0

  // --- Ads data ---
  const adsRaw = adsSnap.data() ?? {}
  const adsSummaryRaw = (adsRaw.summary ?? {}) as Record<string, number>
  const adsDateRange = adsRaw.dateRange as { from?: string; to?: string } | undefined

  // Extract goal-relevant ad metrics
  const adCtr = adsSummaryRaw.ctr ?? 0
  const adCpc = adsSummaryRaw.cpc ?? 0
  const adCpm = adsSummaryRaw.cpm ?? 0
  const adSpend = adsSummaryRaw.spend ?? 0
  const adImpressions = adsSummaryRaw.impressions ?? 0
  const adClicks = adsSummaryRaw.clicks ?? 0
  const adFrequency = adsSummaryRaw.frequency ?? 0
  const adReach = adsSummaryRaw.reach ?? 0

  // --- Post aggregates ---
  const totalFbPosts = fbPosts.length
  const avgEngRate = totalFbPosts > 0 ? Number((fbPosts.reduce((s, p) => s + p.engRate, 0) / totalFbPosts).toFixed(2)) : 0
  const avgReach = totalFbPosts > 0 ? Math.round(fbPosts.reduce((s, p) => s + p.reach, 0) / totalFbPosts) : 0
  const topPosts = [...fbPosts].sort((a, b) => b.engRate - a.engRate).slice(0, 3)
  const underPosts = [...fbPosts].filter(p => p.reach > 50).sort((a, b) => a.engRate - b.engRate).slice(0, 3)

  // --- Goal-aware benchmark comparison ---
  const goalBenchmarks = getBenchmarkByGoal(optimizationGoal)
  const benchmarkCompare = {
    fb: {
      engagementRate: { value: avgEngRate, benchmark: BENCHMARKS.fb.engagementRate, status: avgEngRate >= BENCHMARKS.fb.engagementRate ? 'above' : 'below' as const },
      followerGrowth: { value: followerGrowthRate, benchmark: BENCHMARKS.fb.followerGrowthMonthly, status: followerGrowthRate >= BENCHMARKS.fb.followerGrowthMonthly ? 'above' : 'below' as const },
      adCtr: { value: Number(adCtr.toFixed(2)), benchmark: goalBenchmarks.ctr, status: adCtr >= goalBenchmarks.ctr ? 'above' : 'below' as const },
      adCpc: { value: Number(adCpc.toFixed(2)), benchmark: goalBenchmarks.cpc, status: adCpc > 0 && adCpc <= goalBenchmarks.cpc ? 'above' : 'below' as const },
      adCpm: { value: Number(adCpm.toFixed(2)), benchmark: goalBenchmarks.cpm, status: adCpm > 0 && adCpm <= goalBenchmarks.cpm ? 'above' : 'below' as const },
    },
  }

  return NextResponse.json({
    period: label, periodKey, periodType, isPartial,
    dataAsOf: end.toISOString().slice(0, 10),
    dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    adsDateRange: adsDateRange ? { start: adsDateRange.from ?? '', end: adsDateRange.to ?? '' } : null,
    optimizationGoal, industry,
    overview: { totalPosts: totalFbPosts, avgEngRate, avgReach, followerGrowth, followerGrowthRate, latestFollowers },
    topPosts, underPosts,
    benchmarkCompare,
    benchmarkIndustry: BENCHMARKS.industry,
    adsSummary: {
      spend: adSpend, impressions: adImpressions, clicks: adClicks,
      ctr: Number(adCtr.toFixed(2)), cpc: Number(adCpc.toFixed(2)),
      cpm: Number(adCpm.toFixed(2)), frequency: Number(adFrequency.toFixed(2)),
      reach: adReach, adCount: Array.isArray(adsRaw.adCreatives) ? adsRaw.adCreatives.length : 0,
    },
  })
}
