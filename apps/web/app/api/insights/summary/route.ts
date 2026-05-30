export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { BENCHMARKS } from '@/lib/benchmarks'

// Period helpers
function getPeriodRange(period: string): { start: Date; end: Date; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-based

  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3
    return {
      start: new Date(y, qStart, 1),
      end: new Date(y, qStart + 3, 0, 23, 59, 59),
      label: `Q${Math.floor(qStart / 3) + 1} ${y}`,
    }
  }
  // Default: current month
  return {
    start: new Date(y, m, 1),
    end: new Date(y, m + 1, 0, 23, 59, 59),
    label: `${y}年${m + 1}月`,
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
  const period = req.nextUrl.searchParams.get('period') ?? 'month'

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

  const { start, end, label } = getPeriodRange(period)
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

  // --- Benchmark comparison ---
  const benchmarkCompare = {
    fb: {
      engagementRate: { value: avgEngRate, benchmark: BENCHMARKS.fb.engagementRate, status: avgEngRate >= BENCHMARKS.fb.engagementRate ? 'above' : 'below' },
      followerGrowth: { value: followerGrowthRate, benchmark: BENCHMARKS.fb.followerGrowthMonthly, status: followerGrowthRate >= BENCHMARKS.fb.followerGrowthMonthly ? 'above' : 'below' },
      adCtr: {
        value: Number((adsRaw.ctr ?? 0).toFixed(2)),
        benchmark: BENCHMARKS.fb.ctr,
        status: (adsRaw.ctr ?? 0) >= BENCHMARKS.fb.ctr ? 'above' : 'below'
      },
    },
  }

  return NextResponse.json({
    period: label,
    periodType: period,
    dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
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
      spend: adsRaw.spend ?? 0,
      impressions: adsRaw.impressions ?? 0,
      ctr: Number((adsRaw.ctr ?? 0).toFixed(2)),
      cpm: Number((adsRaw.cpm ?? 0).toFixed(2)),
      cpc: Number((adsRaw.cpc ?? 0).toFixed(2)),
      adCount: Array.isArray(adsRaw.adCreatives) ? adsRaw.adCreatives.length : 0,
    },
  })
}
