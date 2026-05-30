export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { BENCHMARKS } from '@/lib/benchmarks'

// Period helpers
// params: year=2026, month=5 OR year=2026, quarter=2 (1-4)
function getPeriodRange(year: number, periodType: 'month' | 'quarter', value: number): {
  start: Date; end: Date; label: string; isPartial: boolean; periodKey: string
} {
  const now = new Date()

  if (periodType === 'month') {
    const start = new Date(year, value - 1, 1)
    const fullEnd = new Date(year, value, 0, 23, 59, 59)
    const isPartial = now < fullEnd
    const end = isPartial ? now : fullEnd
    return {
      start, end,
      label: `${year}年${value}月`,
      isPartial,
      periodKey: `${year}-${String(value).padStart(2, '0')}`,
    }
  }

  // Quarter: 1=Q1(1-3), 2=Q2(4-6), 3=Q3(7-9), 4=Q4(10-12)
  const QUARTER_LABELS = ['', '1-3月', '4-6月', '7-9月', '10-12月']
  const qStartMonth = (value - 1) * 3
  const start = new Date(year, qStartMonth, 1)
  const fullEnd = new Date(year, qStartMonth + 3, 0, 23, 59, 59)
  const isPartial = now < fullEnd
  const end = isPartial ? now : fullEnd
  return {
    start, end,
    label: `${year} Q${value}（${QUARTER_LABELS[value]}）`,
    isPartial,
    periodKey: `${year}-Q${value}`,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tsMillis = (v: unknown): number => (typeof (v as any)?.toMillis === 'function' ? (v as any).toMillis() : 0)

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  const now = new Date()
  const periodType = (req.nextUrl.searchParams.get('periodType') ?? 'month') as 'month' | 'quarter'
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(now.getFullYear()))
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? String(now.getMonth() + 1))
  const quarter = parseInt(req.nextUrl.searchParams.get('quarter') ?? String(Math.floor(now.getMonth() / 3) + 1))

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

  const { start, end, label, isPartial, periodKey } = getPeriodRange(
    year, periodType, periodType === 'month' ? month : quarter
  )
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  // --- Fetch FB posts for period ---
  const fbSnap = await userRef.collection('pages').doc(pageId).collection('fbPosts')
    .orderBy('createdTime', 'desc').limit(500).get()

  const fbPosts = fbSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => {
      const ms = tsMillis(p.createdTime)
      return ms >= start.getTime() && ms <= end.getTime()
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => ({
      id: p.id,
      message: (p.message ?? '').slice(0, 120),
      createdTime: p.createdTime?.toDate?.()?.toISOString?.() ?? '',
      reach: p.insights?.reach ?? 0,
      reactions: p.insights?.reactions ?? 0,
      comments: p.insights?.comments ?? 0,
      shares: p.insights?.shares ?? 0,
      saves: p.insights?.saves ?? 0,
      permalink: p.permalink ?? '',
      engRate: (p.insights?.reach ?? 0) > 0
        ? Number((((p.insights?.reactions ?? 0) + (p.insights?.comments ?? 0) + (p.insights?.shares ?? 0)) / p.insights.reach * 100).toFixed(2))
        : 0,
    }))

  // --- Follower stats for period ---
  const statsSnap = await userRef.collection('pages').doc(pageId).collection('pageStats').get()
  const followerStats = statsSnap.docs
    .map(d => ({ date: d.data().date ?? d.id, total: d.data().total ?? 0, net: d.data().net ?? 0 }))
    .filter(s => s.date >= start.toISOString().slice(0, 10) && s.date <= end.toISOString().slice(0, 10))
  const followerGrowth = followerStats.reduce((sum, s) => sum + s.net, 0)
  const latestFollowers = followerStats[followerStats.length - 1]?.total ?? 0
  const followerGrowthRate = latestFollowers > 0
    ? Number((followerGrowth / latestFollowers * 100).toFixed(2))
    : 0

  // --- Ads data (latest snapshot) ---
  const adsSnap = await adminDb.collection('users').doc(dataOwnerUid)
    .collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
  const adsRaw = adsSnap.data() ?? {}
  // adInsights structure: { summary: { ctr, spend, impressions, cpm, cpc, ... }, adCreatives, dateRange }
  const adsSummary = (adsRaw.summary ?? {}) as Record<string, number>
  const adsDateRange = adsRaw.dateRange as { from?: string; to?: string } | undefined

  // --- Aggregate FB post metrics ---
  const totalFbPosts = fbPosts.length
  const avgEngRate = totalFbPosts > 0
    ? Number((fbPosts.reduce((s, p) => s + p.engRate, 0) / totalFbPosts).toFixed(2))
    : 0
  const avgReach = totalFbPosts > 0
    ? Math.round(fbPosts.reduce((s, p) => s + p.reach, 0) / totalFbPosts)
    : 0

  // Top 3 posts by engRate
  const topPosts = [...fbPosts].sort((a, b) => b.engRate - a.engRate).slice(0, 3)

  // Bottom 3 posts by engRate (with at least some reach)
  const underPosts = [...fbPosts]
    .filter(p => p.reach > 50)
    .sort((a, b) => a.engRate - b.engRate)
    .slice(0, 3)

  const adCtr = adsSummary.ctr ?? 0

  // --- Benchmark comparison ---
  const benchmarkCompare = {
    fb: {
      engagementRate: { value: avgEngRate, benchmark: BENCHMARKS.fb.engagementRate, status: avgEngRate >= BENCHMARKS.fb.engagementRate ? 'above' : 'below' },
      followerGrowth: { value: followerGrowthRate, benchmark: BENCHMARKS.fb.followerGrowthMonthly, status: followerGrowthRate >= BENCHMARKS.fb.followerGrowthMonthly ? 'above' : 'below' },
      adCtr: {
        value: Number(adCtr.toFixed(2)),
        benchmark: BENCHMARKS.fb.ctr,
        status: adCtr >= BENCHMARKS.fb.ctr ? 'above' : 'below'
      },
    },
  }

  return NextResponse.json({
    period: label,
    periodKey,
    periodType,
    isPartial,
    dataAsOf: end.toISOString().slice(0, 10),
    // Posts date range (calendar month/quarter)
    dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    // Ads date range (from adInsights snapshot, may differ from calendar period)
    adsDateRange: adsDateRange ? { start: adsDateRange.from ?? '', end: adsDateRange.to ?? '' } : null,
    overview: {
      totalPosts: totalFbPosts,
      avgEngRate,
      avgReach,
      followerGrowth,
      followerGrowthRate,
      latestFollowers,
    },
    topPosts,
    underPosts,
    benchmarkCompare,
    benchmarkIndustry: BENCHMARKS.industry,
    adsSummary: {
      spend: adsSummary.spend ?? 0,
      impressions: adsSummary.impressions ?? 0,
      ctr: Number(adCtr.toFixed(2)),
      cpm: Number((adsSummary.cpm ?? 0).toFixed(2)),
      cpc: Number((adsSummary.cpc ?? 0).toFixed(2)),
      adCount: Array.isArray(adsRaw.adCreatives) ? adsRaw.adCreatives.length : 0,
    },
  })
}
