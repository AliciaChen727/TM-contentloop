export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getBenchmarkByIndustry, getBenchmarkByGoal } from '@/lib/benchmarks'
import { resolvePageProfile } from '@/lib/page-profile'
import type { Industry } from '@/lib/profile-types'

// Period helpers
function getPeriodRange(year: number, periodType: 'month' | 'quarter' | 'year', value: number): {
  start: Date; end: Date; label: string; isPartial: boolean; periodKey: string
} {
  // Use Taiwan time (UTC+8) so "today" / month boundaries match the user's calendar.
  // A Date shifted +8h reads its Taiwan wall-clock date via toISOString().
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  if (periodType === 'year') {
    const start = new Date(year, 0, 1)
    const fullEnd = new Date(year, 11, 31, 23, 59, 59)
    const isPartial = now < fullEnd
    return { start, end: isPartial ? now : fullEnd, label: `${year}年 全年`, isPartial, periodKey: `${year}` }
  }
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
  const periodType = (req.nextUrl.searchParams.get('periodType') ?? 'month') as 'month' | 'quarter' | 'year'
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

  const { start, end, label, isPartial, periodKey } = getPeriodRange(year, periodType, periodType === 'month' ? month : periodType === 'quarter' ? quarter : 0)
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  // --- Read page profile (optimizationGoal, industry) ---
  const [profileSnap, adsSnapUser, adsSnapShared] = await Promise.all([
    adminDb.collection('pages').doc(pageId).get(),
    // User-level path (synced by this specific user)
    adminDb.collection('users').doc(dataOwnerUid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get(),
    // Shared path (merged from all admins, more complete)
    adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get(),
  ])
  const profile = profileSnap.data() ?? {}
  // Goal/industry live under onboardingData (page-scoped); fall back to any
  // legacy flat fields, then defaults.
  const ob = (profile.onboardingData ?? {}) as Record<string, unknown>
  // Canonical resolver: page-level override → user onboarding → legacy. This is
  // where a per-page industry (and the data owner's own onboarding, e.g. Irene's
  // education) actually lives — the page doc onboardingData is only a fallback.
  const resolved = await resolvePageProfile(dataOwnerUid, pageId).catch(() => null)
  const optimizationGoal = (resolved?.optimizationGoal ?? ob.optimizationGoal ?? profile.optimizationGoal ?? 'clicks') as string
  const industryKey = (resolved?.industry ?? (ob.industry as Industry | undefined) ?? (profile.industry as Industry | undefined) ?? null)
  const industryOther = resolved?.industryOther ?? (ob.industryOther as string | undefined) ?? null
  const indBench = getBenchmarkByIndustry(industryKey, industryOther)
  const industry = industryKey ?? 'event'

  // --- Fetch FB posts: both page-scoped (live sync) + legacy (CSV/MD import) ---
  // Limit caps Firestore reads/cost. We fetch the latest N then filter by the
  // selected period in JS (createdTime can be a Timestamp OR an ISO string from
  // CSV/MD imports, so a date-range `where` clause is unreliable here).
  // 2000 comfortably covers a full year for any realistic posting cadence.
  const POST_FETCH_LIMIT = 2000
  const [newSnap, legacySnap] = await Promise.all([
    userRef.collection('pages').doc(pageId).collection('fbPosts').orderBy('createdTime', 'desc').limit(POST_FETCH_LIMIT).get(),
    userRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(POST_FETCH_LIMIT).get(),
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
        platform: 'FB' as const,
        permalink: p.permalink ?? '',
        engRate,
      }
    })
    .filter(p => typeof p.message === 'string' && p.message.trim().length > 0)

  // --- Fetch IG posts for the period (page-scoped) ---
  const igSnap = await userRef.collection('pages').doc(pageId).collection('igPosts')
    .orderBy('timestamp', 'desc').limit(POST_FETCH_LIMIT).get()
  const igPosts = igSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => {
      const ms = tsMillis(p.timestamp)
      return ms > 0 && ms >= start.getTime() && ms <= end.getTime()
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => {
      const reach = p.insights?.reach ?? 0
      const likes = p.insights?.likes ?? 0
      const comments = p.insights?.comments ?? 0
      const saves = p.insights?.saves ?? 0
      const engRate = reach > 0 ? Number(((likes + comments + saves) / reach * 100).toFixed(2)) : 0
      const createdTime = p.timestamp?.toDate?.()?.toISOString?.() ?? (typeof p.timestamp === 'string' ? p.timestamp : '')
      return {
        id: p.id,
        message: (p.caption ?? '').slice(0, 120),
        createdTime,
        reach,
        reactions: likes,
        comments,
        shares: 0,
        saves,
        platform: 'IG' as const,
        permalink: p.permalink ?? '',
        engRate,
      }
    })
    .filter(p => typeof p.message === 'string' && p.message.trim().length > 0)

  // Combine FB + IG for all aggregations
  const allPosts = [...fbPosts, ...igPosts]

  // --- Follower stats ---
  const statsSnap = await userRef.collection('pages').doc(pageId).collection('pageStats').get()
  const followerStats = statsSnap.docs
    .map(d => ({ date: d.data().date ?? d.id, total: d.data().total ?? 0, net: d.data().net ?? 0 }))
    .filter(s => s.date >= start.toISOString().slice(0, 10) && s.date <= end.toISOString().slice(0, 10))
  const followerGrowth = followerStats.reduce((sum, s) => sum + s.net, 0)
  const latestFollowers = followerStats[followerStats.length - 1]?.total ?? 0
  const followerGrowthRate = latestFollowers > 0 ? Number((followerGrowth / latestFollowers * 100).toFixed(2)) : 0

  // --- Ads data: prefer user path; fall back to shared path (mirrors ads/data route) ---
  // The stored summary has fields: spend, reach, impressions, clicks, ctr, cpm,
  // frequency, conversions, revenue, roas, cpa. There is NO `cpc` or `link_clicks`.
  // 總覽 displays CPC = summary.cpa (cost per link click) and link_clicks = summary.conversions.
  const adsRawUser = adsSnapUser.data() ?? {}
  const adsRawShared = adsSnapShared.data() ?? {}
  // Prefer user path when it has real summary data (ctr present); else shared.
  const userHasData = ((adsRawUser.summary as Record<string, number> | undefined)?.ctr ?? 0) > 0
    || ((adsRawUser.summary as Record<string, number> | undefined)?.spend ?? 0) > 0
  const adsRaw = userHasData ? adsRawUser : (adsSnapShared.exists ? adsRawShared : adsRawUser)
  const adsSummaryRaw = (adsRaw.summary ?? {}) as Record<string, number>
  const snapshotDateRange = adsRaw.dateRange as { from?: string; to?: string } | undefined
  // 'purchase' campaigns carry real revenue → true ROAS. 'link_click'/'video_view'
  // report no purchase value (revenue == conversions), so ROAS is N/A.
  const conversionType = (adsRaw.conversionType as string) ?? 'link_click'
  const hasPurchase = conversionType === 'purchase'

  // --- Slice the daily ad data to the SELECTED period so ad metrics match the
  // chosen month exactly (not the whole-snapshot summary which spans the last
  // sync's range). Falls back to the snapshot summary when daily doesn't cover it.
  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyAll = Array.isArray(adsRaw.daily) ? (adsRaw.daily as any[]) : []
  const dailyInPeriod = dailyAll.filter(d => typeof d?.date === 'string' && d.date >= startStr && d.date <= endStr)

  let adCtr: number, adSpend: number, adLinkClicks: number, adCpc: number, adCpm: number,
    adImpressions: number, adClicks: number, adFrequency: number, adReach: number
  let adCoverage: { start: string; end: string } | null = null

  if (dailyInPeriod.length > 0) {
    // Aggregate from daily within the selected period (same formulas as sync's page summary)
    const sum = (k: string) => dailyInPeriod.reduce((s, d) => s + (Number(d[k]) || 0), 0)
    adSpend = sum('spend')
    adImpressions = sum('impressions')
    adReach = sum('reach')
    const allClicks = sum('clicks')
    adLinkClicks = sum('conversions')
    adCtr = adImpressions > 0 ? Number((allClicks / adImpressions * 100).toFixed(2)) : 0
    adCpc = adLinkClicks > 0 ? Number((adSpend / adLinkClicks).toFixed(2)) : 0
    adCpm = adImpressions > 0 ? Number((adSpend / adImpressions * 1000).toFixed(2)) : 0
    adFrequency = adReach > 0 ? Number((adImpressions / adReach).toFixed(2)) : 0
    adClicks = adLinkClicks > 0 ? adLinkClicks : allClicks
    const dates = dailyInPeriod.map(d => d.date as string).sort()
    adCoverage = { start: dates[0], end: dates[dates.length - 1] }
  } else {
    // Fallback: whole-snapshot summary (period not covered by daily data)
    adCtr = adsSummaryRaw.ctr ?? 0
    adSpend = adsSummaryRaw.spend ?? 0
    adLinkClicks = adsSummaryRaw.conversions ?? 0
    adCpc = (adsSummaryRaw.cpa ?? 0) > 0
      ? adsSummaryRaw.cpa
      : (adSpend > 0 && adLinkClicks > 0 ? Number((adSpend / adLinkClicks).toFixed(2)) : 0)
    adCpm = adsSummaryRaw.cpm ?? 0
    adImpressions = adsSummaryRaw.impressions ?? 0
    adClicks = adLinkClicks > 0 ? adLinkClicks : (adsSummaryRaw.clicks ?? 0)
    adFrequency = adsSummaryRaw.frequency ?? 0
    adReach = adsSummaryRaw.reach ?? 0
    adCoverage = snapshotDateRange ? { start: snapshotDateRange.from ?? '', end: snapshotDateRange.to ?? '' } : null
  }

  // Ad count = number of advertised posts in the snapshot (FB + IG), matching the
  // dashboard's "共 X 篇貼文有投廣告". adCreatives alone only counts ACTIVE creatives
  // (finished ads excluded), which under-counts a monthly report. Prefer the union
  // of advertised post ids / metrics; fall back to adCreatives length.
  const fbAdIds = new Set<string>([
    ...(Array.isArray(adsRaw.adPostIds) ? adsRaw.adPostIds as string[] : []),
    ...Object.keys((adsRaw.adPostMetrics as Record<string, unknown>) ?? {}),
  ])
  const igAdIds = new Set<string>([
    ...(Array.isArray(adsRaw.igPostIds) ? adsRaw.igPostIds as string[] : []),
    ...Object.keys((adsRaw.igPostMetrics as Record<string, unknown>) ?? {}),
  ])
  const advertisedPostCount = fbAdIds.size + igAdIds.size
  const adCreativesCount = Array.isArray(adsRaw.adCreatives) ? adsRaw.adCreatives.length : 0
  const adCount = advertisedPostCount > 0 ? advertisedPostCount : adCreativesCount

  // --- Best / worst ad creatives (for the ad-level analysis section) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseAction = (actions: any[], type: string): number =>
    Array.isArray(actions) ? (actions.find(a => a?.action_type === type)?.value ? parseFloat(actions.find(a => a?.action_type === type).value) : 0) : 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawCreatives = (Array.isArray(adsRaw.adCreatives) ? adsRaw.adCreatives as any[] : [])
    .map(c => {
      const spend = parseFloat(c.spend ?? '0')
      const ctr = parseFloat(c.ctr ?? '0')
      const impressions = parseInt(c.impressions ?? '0')
      const linkClicks = parseAction(c.actions, 'link_click')
      const cpa = linkClicks > 0 ? Number((spend / linkClicks).toFixed(2)) : 0
      return {
        name: (c.post_title ?? c.ad_name ?? '廣告').slice(0, 60),
        ctr: Number(ctr.toFixed(2)),
        cpa,
        spend: Number(spend.toFixed(2)),
        linkClicks,
        impressions,
        thumbnailUrl: c.thumbnail_url ?? null,
        storyId: c.effective_object_story_id ?? null,
      }
    })
    .filter(c => c.spend > 0 || c.impressions > 0)

  // Fallback for FINISHED ads: adCreatives only keeps ACTIVE creatives, so a page
  // whose ads have all ended (e.g. Legacy) shows no ad analysis. Rebuild from
  // adPostMetrics/igPostMetrics (which include finished ads) joined to posts.
  type AdMetric = { spend?: number; ctr?: number; cpa?: number; reach?: number }
  const fbPostMetrics = (adsRaw.adPostMetrics ?? {}) as Record<string, AdMetric>
  const igPostMetrics = (adsRaw.igPostMetrics ?? {}) as Record<string, AdMetric>
  const metricsAds = [
    ...Object.entries(fbPostMetrics).map(([postId, m]) => {
      const post = fbPosts.find(p => p.id === postId || p.id.endsWith(`_${postId}`))
      return {
        name: (post?.message || '廣告貼文').slice(0, 60),
        ctr: Number((m.ctr ?? 0).toFixed(2)),
        cpa: Number((m.cpa ?? 0).toFixed(2)),
        spend: Number((m.spend ?? 0).toFixed(2)),
        linkClicks: 0,
        impressions: 0,
        thumbnailUrl: null as string | null,
        storyId: post?.id ?? `${pageId}_${postId}`,
      }
    }),
    ...Object.entries(igPostMetrics).map(([postId, m]) => {
      const post = igPosts.find(p => p.id === postId)
      return {
        name: (post?.message || '廣告貼文').slice(0, 60),
        ctr: Number((m.ctr ?? 0).toFixed(2)),
        cpa: Number((m.cpa ?? 0).toFixed(2)),
        spend: Number((m.spend ?? 0).toFixed(2)),
        linkClicks: 0,
        impressions: 0,
        thumbnailUrl: null as string | null,
        storyId: null as string | null,
      }
    }),
  ].filter(a => a.spend > 0 || a.ctr > 0)

  // Prefer adCreatives (richer: thumbnail/storyId) but use metrics fallback when empty.
  const adListSource = rawCreatives.length > 0 ? rawCreatives : metricsAds
  // Split into best/worst WITHOUT overlap. With only 1 ad → analyze just that one
  // (topAds=[ad], underAds=[]); with 2+ ads → top half vs the rest.
  const sortedAds = [...adListSource].sort((a, b) => b.ctr - a.ctr) // high → low CTR
  const n = sortedAds.length
  const topCount = n <= 1 ? n : Math.min(3, Math.ceil(n / 2))
  const topAds = sortedAds.slice(0, topCount)
  const underAds = n <= 1 ? [] : sortedAds.slice(topCount).filter(c => c.spend > 0).slice(-3)

  // --- A/B test context (experiments + creative variant labels) ---
  const [abSnap, expColSnap, labelsColSnap] = await Promise.all([
    adminDb.collection('pages').doc(pageId).collection('abTests').doc('current').get(),
    adminDb.collection('pages').doc(pageId).collection('experiments').get(),
    adminDb.collection('pages').doc(pageId).collection('creativeLabels').get(),
  ])
  const abData = abSnap.data() ?? {}
  const variantLabels = labelsColSnap.docs.map(d => ({ adId: d.id, variant: d.data().variant ?? '', experimentId: d.data().experimentId ?? '' }))

  // Per-ad metrics by ad_id, to compute concrete per-variant (A vs control) stats.
  const adById = new Map<string, { ctr: number; spend: number; impressions: number; linkClicks: number }>()
  const adCreativesList = Array.isArray(adsRaw.adCreatives) ? (adsRaw.adCreatives as Record<string, unknown>[]) : []
  for (const c of adCreativesList) {
    if (!c.ad_id) continue
    adById.set(c.ad_id as string, {
      ctr: parseFloat((c.ctr as string) ?? '0'),
      spend: parseFloat((c.spend as string) ?? '0'),
      impressions: parseInt((c.impressions as string) ?? '0'),
      linkClicks: parseAction(c.actions as unknown[], 'link_click'),
    })
  }
  // Aggregate per (experimentId, variant): impression-weighted CTR, total spend/clicks.
  function variantStatsFor(expId: string) {
    const byVariant = new Map<string, { impressions: number; clicks: number; spend: number; linkClicks: number }>()
    for (const lbl of variantLabels) {
      if (lbl.experimentId !== expId || !lbl.variant) continue
      const m = adById.get(lbl.adId)
      if (!m) continue
      const v = byVariant.get(lbl.variant) ?? { impressions: 0, clicks: 0, spend: 0, linkClicks: 0 }
      v.impressions += m.impressions
      v.clicks += Math.round(m.impressions * m.ctr / 100) // reconstruct clicks from ctr×impressions
      v.spend += m.spend
      v.linkClicks += m.linkClicks
      byVariant.set(lbl.variant, v)
    }
    return Array.from(byVariant.entries()).map(([variant, v]) => ({
      variant,
      ctr: v.impressions > 0 ? Number((v.clicks / v.impressions * 100).toFixed(2)) : 0,
      impressions: v.impressions,
      spend: Number(v.spend.toFixed(2)),
      linkClicks: v.linkClicks,
      cpa: v.linkClicks > 0 ? Number((v.spend / v.linkClicks).toFixed(2)) : 0,
    })).sort((a, b) => b.ctr - a.ctr)
  }

  const experiments = expColSnap.docs.map(d => ({
    name: d.data().name ?? '',
    winner: d.data().winner ?? 'pending',
    aiDiagnosis: (d.data().aiDiagnosis ?? '').slice(0, 500),
    variants: variantStatsFor(d.id),
  })).filter(e => e.name || e.aiDiagnosis || e.variants.length > 0)

  const abTest = {
    aiDiagnosis: (abData.aiDiagnosis ?? '').slice(0, 800),
    winner: abData.winner ?? 'pending',
    experimentName: abData.experimentName ?? '',
    experiments,
    variantCount: variantLabels.length,
  }
  const hasAbTest = !!(abTest.aiDiagnosis || abTest.experimentName || experiments.length > 0 || variantLabels.length > 0)

  // --- Post aggregates (FB + IG combined) ---
  const totalPosts = allPosts.length
  // Engagement rate is only meaningful for posts that actually have insights synced
  // (reach > 0). Posts with reach 0 (engagement not yet synced/imported) are excluded
  // from the average so they don't drag it to 0%.
  const postsWithReach = allPosts.filter(p => p.reach > 0)
  const avgEngRate = postsWithReach.length > 0
    ? Number((postsWithReach.reduce((s, p) => s + p.engRate, 0) / postsWithReach.length).toFixed(2))
    : 0
  const avgReach = postsWithReach.length > 0
    ? Math.round(postsWithReach.reduce((s, p) => s + p.reach, 0) / postsWithReach.length)
    : 0
  const fbCount = fbPosts.length
  const igCount = igPosts.length
  const topPosts = [...postsWithReach].sort((a, b) => b.engRate - a.engRate).slice(0, 3)
  const underPosts = [...postsWithReach].filter(p => p.reach > 50).sort((a, b) => a.engRate - b.engRate).slice(0, 3)

  // --- Goal-aware benchmark comparison ---
  const goalBenchmarks = getBenchmarkByGoal(optimizationGoal)
  const benchmarkCompare = {
    fb: {
      engagementRate: { value: avgEngRate, benchmark: indBench.fb.engagementRate, status: avgEngRate >= indBench.fb.engagementRate ? 'above' : 'below' as const },
      followerGrowth: { value: followerGrowthRate, benchmark: indBench.fb.followerGrowthMonthly, status: followerGrowthRate >= indBench.fb.followerGrowthMonthly ? 'above' : 'below' as const },
      adCtr: { value: Number(adCtr.toFixed(2)), benchmark: goalBenchmarks.ctr, status: adCtr === 0 ? 'nodata' : adCtr >= goalBenchmarks.ctr ? 'above' : 'below' as const },
      adCpc: { value: Number(adCpc.toFixed(2)), benchmark: goalBenchmarks.cpc, status: adCpc === 0 ? 'nodata' : adCpc <= goalBenchmarks.cpc ? 'above' : 'below' as const },
      adCpm: { value: Number(adCpm.toFixed(2)), benchmark: goalBenchmarks.cpm, status: adCpm === 0 ? 'nodata' : adCpm <= goalBenchmarks.cpm ? 'above' : 'below' as const },
      // ROAS only meaningful with purchase tracking; otherwise N/A.
      adRoas: hasPurchase
        ? { value: Number((adsSummaryRaw.roas ?? 0).toFixed(2)), benchmark: 0, status: 'above' as const }
        : { value: 0, benchmark: 0, status: 'nodata' as const },
    },
  }

  return NextResponse.json({
    period: label, periodKey, periodType, isPartial,
    dataAsOf: end.toISOString().slice(0, 10),
    dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    adsDateRange: adCoverage,
    optimizationGoal, industry, conversionType,
    overview: { totalPosts, fbCount, igCount, avgEngRate, avgReach, followerGrowth, followerGrowthRate, latestFollowers },
    topPosts, underPosts,
    topAds, underAds,
    abTest, hasAbTest,
    benchmarkCompare,
    benchmarkIndustry: indBench.label,
    benchmarkIndustrySet: indBench.isSet,
    industryOther,
    adsSummary: {
      spend: adSpend, impressions: adImpressions, clicks: adClicks,
      ctr: Number(adCtr.toFixed(2)), cpc: Number(adCpc.toFixed(2)),
      cpm: Number(adCpm.toFixed(2)), frequency: Number(adFrequency.toFixed(2)),
      reach: adReach, adCount,
    },
  })
}
