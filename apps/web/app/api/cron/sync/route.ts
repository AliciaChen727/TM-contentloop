export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { fetchPageFollowerStats } from '@/lib/meta/fetchPageFollowerStats'
import { syncIgStories } from '@/lib/meta/igStories'
import { processPageAlerts } from '@/lib/alerts/processAlerts'

const BASE = 'https://graph.facebook.com/v19.0'

type MetaAction = { action_type: string; value: string }

function parseActions(actions: MetaAction[], type: string): number {
  return parseFloat(actions.find(a => a.action_type === type)?.value ?? '0')
}

// ── FB Posts Sync ─────────────────────────────────────────────────────────────

async function syncFbForUser(uid: string, accessToken: string, pageId: string): Promise<{ synced: number; error?: string }> {
  const postsUrl = new URL(`${BASE}/${pageId}/posts`)
  postsUrl.searchParams.set('fields', 'id,message,story,created_time,permalink_url')
  postsUrl.searchParams.set('limit', '100')
  postsUrl.searchParams.set('access_token', accessToken)

  const postsRes = await fetch(postsUrl)
  const postsData = await postsRes.json()
  if (!postsRes.ok || postsData.error) return { synced: 0, error: postsData.error?.message ?? 'posts fetch failed' }

  type RawPost = { id: string; message?: string; story?: string; created_time: string; permalink_url?: string }
  const allPosts: RawPost[] = postsData.data ?? []

  // Posts with user-written text → save; story-only / empty → delete from Firestore
  const posts = allPosts.filter(p => p.message)
  const storyOnlyIds = allPosts.filter(p => !p.message).map(p => p.id)

  // Fetch insights per post in parallel
  const withInsights = await Promise.all(posts.map(async post => {
    try {
      const insUrl = new URL(`${BASE}/${post.id}/insights`)
      insUrl.searchParams.set('metric', 'post_reactions_by_type_total,post_impressions_unique,post_activity_by_action_type,post_impressions_paid_unique,post_impressions_organic_unique')
      insUrl.searchParams.set('period', 'lifetime')
      insUrl.searchParams.set('access_token', accessToken)
      const insRes = await fetch(insUrl)
      const insData = await insRes.json()
      const vals: Record<string, unknown> = {}
      for (const item of (insData.data ?? []) as { name: string; values: { value: unknown }[] }[]) {
        vals[item.name] = item.values?.[0]?.value ?? 0
      }
      const reactionsByType = vals.post_reactions_by_type_total as Record<string, number> ?? {}
      const reactions = Object.values(reactionsByType).reduce((s, v) => s + v, 0)
      const activity = vals.post_activity_by_action_type as Record<string, number> ?? {}
      return { ...post, insights: { reactions, reach: (vals.post_impressions_unique as number) ?? 0, comments: activity.comment ?? 0, shares: activity.share ?? 0, paidReach: (vals.post_impressions_paid_unique as number) ?? 0, organicReach: (vals.post_impressions_organic_unique as number) ?? 0 } }
    } catch {
      return { ...post, insights: { reactions: 0, reach: 0, comments: 0, shares: 0, paidReach: 0, organicReach: 0 } }
    }
  }))

  const userRef = adminDb.collection('users').doc(uid)
  const fbPostsCol = userRef.collection('pages').doc(pageId).collection('fbPosts')
  const batch = adminDb.batch()
  for (const post of withInsights) {
    const postRef = fbPostsCol.doc(post.id)
    batch.set(postRef, {
      message: post.message ?? '',
      createdTime: Timestamp.fromDate(new Date(post.created_time)),
      permalink: post.permalink_url ?? '',
      insights: post.insights,
      syncedAt: Timestamp.now(),
    }, { merge: true })
  }
  // Delete story-only / empty posts that were previously stored
  for (const id of storyOnlyIds) {
    batch.delete(fbPostsCol.doc(id))
  }
  await batch.commit()

  // Clean up orphaned docs with empty message (outside the 200-post API window)
  const emptySnap = await fbPostsCol.where('message', '==', '').limit(50).get()
  if (emptySnap.size > 0) {
    const cleanBatch = adminDb.batch()
    emptySnap.docs.forEach(d => cleanBatch.delete(d.ref))
    await cleanBatch.commit()
  }

  // Clean up FB story promotion text docs stored by old cron (message || story)
  const STORY_PREFIX = '這則貼文沒有文字' // 這則貼文沒有文字
  const storySnap = await fbPostsCol
    .where('message', '>=', STORY_PREFIX)
    .where('message', '<=', STORY_PREFIX + '')
    .limit(50).get()
  if (storySnap.size > 0) {
    const storyBatch = adminDb.batch()
    storySnap.docs.forEach(d => storyBatch.delete(d.ref))
    await storyBatch.commit()
  }

  // Page-level follower stats (daily time series). Best-effort, never blocks post sync.
  try {
    const stats = await fetchPageFollowerStats(pageId, accessToken)
    if (stats.length > 0) {
      const statsCol = userRef.collection('pages').doc(pageId).collection('pageStats')
      const statsBatch = adminDb.batch()
      const now = Timestamp.now()
      for (const s of stats) {
        statsBatch.set(statsCol.doc(s.date), { ...s, snapshotAt: now }, { merge: true })
      }
      await statsBatch.commit()
    }
  } catch { /* follower stats are best-effort */ }

  return { synced: posts.length }
}

// ── IG Posts Sync ─────────────────────────────────────────────────────────────

async function syncIgForUser(uid: string, accessToken: string, igUserId: string, pageId: string): Promise<{ synced: number; error?: string }> {
  const mediaUrl = new URL(`${BASE}/${igUserId}/media`)
  mediaUrl.searchParams.set('fields', 'id,timestamp,caption,media_type,media_product_type,permalink,like_count,comments_count')
  mediaUrl.searchParams.set('limit', '50')
  mediaUrl.searchParams.set('access_token', accessToken)

  const mediaRes = await fetch(mediaUrl)
  const mediaData = await mediaRes.json()
  if (!mediaRes.ok || mediaData.error) return { synced: 0, error: mediaData.error?.message ?? 'media fetch failed' }

  const posts: Record<string, unknown>[] = mediaData.data ?? []

  type IgPost = { id: string; timestamp: string; caption?: string; media_type: string; media_product_type?: string; permalink: string; like_count: number; comments_count: number }

  // Fetch insights per post in parallel (with individual error handling)
  const withInsights = await Promise.all((posts as IgPost[]).map(async post => {
    const isReel = post.media_product_type === 'REELS'
    const isFeedVideo = (post.media_type === 'VIDEO') && !isReel
    // Reels: plays and video_views deprecated in v22.0+; feed videos support video_views
    const metrics = isFeedVideo ? 'reach,saved,shares,video_views' : 'reach,saved,shares'
    const insUrl = new URL(`${BASE}/${post.id}/insights`)
    insUrl.searchParams.set('metric', metrics)
    insUrl.searchParams.set('period', 'lifetime')
    insUrl.searchParams.set('access_token', accessToken)

    try {
      const insRes = await fetch(insUrl)
      const insData = await insRes.json()
      if (insData.error) {
        console.warn(`[cron/sync] IG insights error for ${post.id} (${post.media_type}):`, JSON.stringify(insData.error))
        return { ...post, _ins: {} as Record<string, number> }
      }
      const vals: Record<string, number> = {}
      for (const m of (insData.data ?? []) as { name: string; values: { value: number }[] }[]) vals[m.name] = m.values?.[0]?.value ?? 0
      return { ...post, _ins: vals }
    } catch (e) {
      console.warn(`[cron/sync] IG insights fetch exception for ${post.id}:`, e)
      return { ...post, _ins: {} as Record<string, number> }
    }
  }))

  const userRef = adminDb.collection('users').doc(uid)
  const igPostsCol = userRef.collection('pages').doc(pageId).collection('igPosts')
  const batch = adminDb.batch()
  for (const post of withInsights) {
    const ins = post._ins
    const postRef = igPostsCol.doc(post.id)
    batch.set(postRef, {
      id: post.id,
      caption: post.caption ?? '',
      mediaType: post.media_product_type === 'REELS' ? 'REELS' : post.media_type,
      permalink: post.permalink,
      timestamp: Timestamp.fromDate(new Date(post.timestamp)),
      insights: {
        likes: (post.like_count as number) ?? 0,
        comments: (post.comments_count as number) ?? 0,
        reach: ins.reach ?? 0,
        saved: ins.saved ?? 0,
        shares: ins.shares ?? 0,
        views: ins.video_views ?? ins.plays ?? 0,
      },
      syncedAt: Timestamp.now(),
    }, { merge: true })
  }
  await batch.commit()
  return { synced: posts.length }
}

// ── Ads Sync ──────────────────────────────────────────────────────────────────

async function syncAdsForUser(uid: string, userAccessToken: string, pageId: string, igUserId?: string): Promise<{ adAccountId?: string; spend?: number; reach?: number; conversionType?: string; linkClicks?: number; videoViews?: number; pageAdsCount?: number; error?: string }> {
  const accountsUrl = new URL(`${BASE}/me/adaccounts`)
  accountsUrl.searchParams.set('fields', 'id,name')
  accountsUrl.searchParams.set('access_token', userAccessToken)
  const accountsRes = await fetch(accountsUrl)
  const accountsData = await accountsRes.json()
  if (!accountsRes.ok || accountsData.error) return { error: accountsData.error?.message ?? 'get adaccounts failed' }

  const accounts: { id: string }[] = accountsData.data ?? []
  if (!accounts.length) return { error: 'no ad accounts' }
  const adAccountId = accounts[0].id

  const insightFields = 'spend,reach,impressions,clicks,ctr,cpm,frequency,actions,action_values'
  const summaryUrl = new URL(`${BASE}/${adAccountId}/insights`)
  summaryUrl.searchParams.set('fields', insightFields)
  summaryUrl.searchParams.set('date_preset', 'last_30d')
  summaryUrl.searchParams.set('level', 'account')
  summaryUrl.searchParams.set('access_token', userAccessToken)

  const dailyUrl = new URL(`${BASE}/${adAccountId}/insights`)
  dailyUrl.searchParams.set('fields', insightFields)
  dailyUrl.searchParams.set('date_preset', 'last_30d')
  dailyUrl.searchParams.set('time_increment', '1')
  dailyUrl.searchParams.set('level', 'account')
  dailyUrl.searchParams.set('access_token', userAccessToken)

  const adsUrl = new URL(`${BASE}/${adAccountId}/ads`)
  adsUrl.searchParams.set('fields', 'id,name,effective_status,effective_object_story_id,creative{object_story_id,effective_object_story_id,effective_instagram_story_id}')
  adsUrl.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED"]')
  adsUrl.searchParams.set('limit', '100')
  adsUrl.searchParams.set('access_token', userAccessToken)

  const adLevelUrl = new URL(`${BASE}/${adAccountId}/insights`)
  adLevelUrl.searchParams.set('fields', 'ad_id,ad_name,spend,reach,impressions,ctr,actions,action_values')
  adLevelUrl.searchParams.set('date_preset', 'last_30d')
  adLevelUrl.searchParams.set('level', 'ad')
  adLevelUrl.searchParams.set('limit', '100')
  adLevelUrl.searchParams.set('access_token', userAccessToken)

  const hourlyUrl = new URL(`${BASE}/${adAccountId}/insights`)
  hourlyUrl.searchParams.set('fields', 'spend,actions,action_values')
  hourlyUrl.searchParams.set('date_preset', 'last_30d')
  hourlyUrl.searchParams.set('level', 'account')
  hourlyUrl.searchParams.set('breakdowns', 'hourly_stats_aggregated_by_advertiser_time_zone')
  hourlyUrl.searchParams.set('access_token', userAccessToken)

  const [summaryRes, dailyRes, adsRes, adLevelRes, hourlyRes] = await Promise.all([fetch(summaryUrl), fetch(dailyUrl), fetch(adsUrl), fetch(adLevelUrl), fetch(hourlyUrl)])
  const [summaryData, dailyData, adsData, adLevelData, hourlyData] = await Promise.all([summaryRes.json(), dailyRes.json(), adsRes.json(), adLevelRes.json(), hourlyRes.json()])
  if (!summaryRes.ok || summaryData.error) return { error: summaryData.error?.message ?? 'insights failed' }
  // Fix: also validate ad-level insights — silent failure here causes all creatives to show $0
  if (!adLevelRes.ok || adLevelData.error) return { error: adLevelData.error?.message ?? 'ad-level insights failed' }

  // Filter ads to only those belonging to this pageId (object_story_id format: {pageId}_{postId})
  // Strict: never fall back to all-account ads — that would contaminate other pages' dashboards
  const rawAdsList: { id: string; name: string; creative?: { object_story_id?: string; effective_instagram_story_id?: string; instagram_actor_id?: string } }[] = adsData.data ?? []
  const pageAdsList = rawAdsList.filter(ad => {
    if (ad.creative?.object_story_id?.startsWith(pageId + '_')) return true
    if (igUserId && ad.creative?.instagram_actor_id === igUserId) return true
    return false
  })
  const adPostIds: string[] = pageAdsList.map(ad => ad.creative?.object_story_id || ad.creative?.effective_instagram_story_id).filter(Boolean) as string[]

  const s = summaryData.data?.[0] ?? {}
  const spend = parseFloat(s.spend ?? '0')
  const reach = parseInt(s.reach ?? '0')
  const impressions = parseInt(s.impressions ?? '0')
  const clicks = parseInt(s.clicks ?? '0')
  const ctr = parseFloat(s.ctr ?? '0')
  const cpm = parseFloat(s.cpm ?? '0')
  const frequency = parseFloat(s.frequency ?? '0')
  const sActions: MetaAction[] = s.actions ?? []
  const sActionValues: MetaAction[] = s.action_values ?? []
  const hasPurchase = sActions.some(a => a.action_type === 'purchase')
  const linkClicks = parseActions(sActions, 'link_click')
  const videoViews = parseActions(sActions, 'video_view')
  // Detect campaign type: purchase > link_click > video_view > fallback
  const conversionType = hasPurchase ? 'purchase'
    : linkClicks > 0 ? 'link_click'
    : videoViews > 0 ? 'video_view'
    : 'link_click'
  const primaryMetric = hasPurchase ? parseActions(sActionValues, 'purchase')
    : linkClicks > 0 ? linkClicks
    : videoViews
  const conversions = primaryMetric
  const revenue = primaryMetric
  // ROAS = interactions per NT$100 (works for purchase, link_click, video_view)
  const roas = spend > 0 && primaryMetric > 0
    ? (hasPurchase ? parseFloat((revenue / spend).toFixed(2)) : parseFloat((primaryMetric / spend * 100).toFixed(2)))
    : 0
  const cpa = conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : 0

  const rawDaily: Record<string, unknown>[] = dailyData.data ?? []
  const daily = rawDaily.map(d => {
    const daySpend = parseFloat((d.spend as string) ?? '0')
    const dayActions: MetaAction[] = (d.actions as MetaAction[]) ?? []
    const dayActionValues: MetaAction[] = (d.action_values as MetaAction[]) ?? []
    const dayLinkClicks = parseActions(dayActions, 'link_click')
    const dayVideoViews = parseActions(dayActions, 'video_view')
    const dayPrimary = hasPurchase ? parseActions(dayActionValues, 'purchase')
      : linkClicks > 0 ? dayLinkClicks
      : dayVideoViews
    return {
      date: d.date_start as string,
      spend: daySpend,
      reach: parseInt((d.reach as string) ?? '0'),
      impressions: parseInt((d.impressions as string) ?? '0'),
      clicks: parseInt((d.clicks as string) ?? '0'),
      ctr: parseFloat((d.ctr as string) ?? '0'),
      roas: daySpend > 0 && dayPrimary > 0
        ? (hasPurchase ? parseFloat((dayPrimary / daySpend).toFixed(2)) : parseFloat((dayPrimary / daySpend * 100).toFixed(2)))
        : 0,
      conversions: dayPrimary,
      revenue: dayPrimary,
    }
  })

  const rawHourly: Record<string, unknown>[] = hourlyData.data ?? []
  const hourly = rawHourly.map(h => {
    const hourSpend = parseFloat((h.spend as string) ?? '0')
    const hourActions: MetaAction[] = (h.actions as MetaAction[]) ?? []
    const hourActionValues: MetaAction[] = (h.action_values as MetaAction[]) ?? []
    const hourLinkClicks = parseActions(hourActions, 'link_click')
    const hourVideoViews = parseActions(hourActions, 'video_view')
    const hourPrimary = hasPurchase ? parseActions(hourActionValues, 'purchase')
      : linkClicks > 0 ? hourLinkClicks
      : hourVideoViews
    const hourLabel = (h.hourly_stats_aggregated_by_advertiser_time_zone as string) ?? '0:00 - 1:00'
    return {
      hour: parseInt(hourLabel.split(':')[0]),
      spend: hourSpend,
      roas: hourSpend > 0 && hourPrimary > 0
        ? (hasPurchase ? parseFloat((hourPrimary / hourSpend).toFixed(2)) : parseFloat((hourPrimary / hourSpend * 100).toFixed(2)))
        : 0,
    }
  }).sort((a, b) => a.hour - b.hour)

  // Merge ads list with insights: show all ads even if spend=0
  const insightsByAdId = new Map<string, Record<string, unknown>>()
  for (const item of (adLevelData.data ?? []) as Record<string, unknown>[]) {
    if (typeof item.ad_id === 'string') insightsByAdId.set(item.ad_id, item)
  }
  const adCreatives: Record<string, unknown>[] = pageAdsList.map(ad =>
    insightsByAdId.get(ad.id) ?? { ad_id: ad.id, ad_name: ad.name, spend: '0', impressions: '0', ctr: '0', actions: [], action_values: [] }
  )

  const userRef = adminDb.collection('users').doc(uid)
  const dateRange = { from: daily[0]?.date ?? '', to: daily[daily.length - 1]?.date ?? '' }
  const summaryDoc = { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa, conversionType, linkClicks, videoViews }

  // Existing UID-scoped write (backward compat + fallback)
  await userRef.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange,
    adAccountId,
    conversionType,
    summary: summaryDoc,
    daily,
    hourly,
    adPostIds,
    adCreatives,
  }, { merge: true })

  // NEW: shared page-level snapshot (enables cross-admin merged view)
  await adminDb.collection('pages').doc(pageId).collection('adAccountSnapshots').doc(adAccountId).set({
    adAccountId,
    contributorUid: uid,
    syncedAt: Timestamp.now(),
    dateRange,
    conversionType,
    summary: summaryDoc,
    daily,
    hourly,
    adCreatives,
  }, { merge: true })

  return { adAccountId, spend, reach, conversionType, linkClicks, videoViews, pageAdsCount: pageAdsList.length }
}

// ── Cross-admin Merge ─────────────────────────────────────────────────────────

type SummaryFields = { spend: number; reach: number; impressions: number; clicks: number; conversions: number; revenue: number }
type DayRow = { date: string; spend: number; reach: number; impressions: number; clicks: number; conversions: number; revenue: number }

function mergeSummaries(snapshots: { summary?: Record<string, number> }[]): Record<string, number> {
  let spend = 0, reach = 0, impressions = 0, clicks = 0, conversions = 0, revenue = 0
  for (const s of snapshots) {
    const m = s.summary ?? {}
    spend       += m.spend       ?? 0
    reach       += m.reach       ?? 0
    impressions += m.impressions ?? 0
    clicks      += m.clicks      ?? 0
    conversions += m.conversions ?? 0
    revenue     += m.revenue     ?? 0
  }
  return {
    spend, reach, impressions, clicks, conversions, revenue,
    ctr:       impressions > 0 ? clicks / impressions : 0,
    cpm:       impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa:       conversions > 0 ? spend / conversions : 0,
    // For non-purchase accounts: use conversions (link_clicks) / spend * 100 as click efficiency
    roas:      spend > 0 && conversions > 0
      ? (revenue !== conversions ? revenue / spend : conversions / spend * 100)
      : 0,
    frequency: reach > 0 ? impressions / reach : 0,
  }
}

type HourRow = { hour: number; spend: number; roas: number }

function mergeHourlyArrays(snapshots: { hourly?: HourRow[] }[]): HourRow[] {
  const byHour = new Map<number, { spend: number; revenue: number }>()
  for (const s of snapshots) {
    for (const h of s.hourly ?? []) {
      const e = byHour.get(h.hour) ?? { spend: 0, revenue: 0 }
      byHour.set(h.hour, { spend: e.spend + h.spend, revenue: e.revenue + h.roas * h.spend })
    }
  }
  return Array.from(byHour.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, { spend, revenue }]) => ({
      hour,
      spend,
      roas: spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
    }))
}

function mergeDailyArrays(snapshots: { daily?: DayRow[] }[]): DayRow[] {
  const byDate = new Map<string, SummaryFields>()
  for (const s of snapshots) {
    for (const d of s.daily ?? []) {
      const e = byDate.get(d.date) ?? { spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
      e.spend       += d.spend       ?? 0
      e.reach       += d.reach       ?? 0
      e.impressions += d.impressions ?? 0
      e.clicks      += d.clicks      ?? 0
      e.conversions += d.conversions ?? 0
      e.revenue     += d.revenue     ?? 0
      byDate.set(d.date, e)
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({
      date,
      spend: e.spend, reach: e.reach, impressions: e.impressions, clicks: e.clicks,
      conversions: e.conversions, revenue: e.revenue,
      ctr:  e.impressions > 0 ? e.clicks / e.impressions : 0,
      // For non-purchase accounts: use conversions / spend * 100 as click efficiency
      roas: e.spend > 0 && e.conversions > 0
        ? (e.revenue !== e.conversions ? e.revenue / e.spend : e.conversions / e.spend * 100)
        : 0,
    }))
}

async function mergePageAdInsights(pageId: string): Promise<void> {
  const snapsSnap = await adminDb.collection('pages').doc(pageId).collection('adAccountSnapshots').get()
  if (snapsSnap.empty) return

  // Dedup by adAccountId: latest syncedAt wins
  const byAccount = new Map<string, FirebaseFirestore.DocumentData>()
  for (const doc of snapsSnap.docs) {
    const data = doc.data()
    const existing = byAccount.get(data.adAccountId)
    if (!existing || data.syncedAt > existing.syncedAt) byAccount.set(data.adAccountId, data)
  }
  const deduped = Array.from(byAccount.values())

  const mergedSummary = mergeSummaries(deduped)
  const mergedDaily = mergeDailyArrays(deduped as { daily?: DayRow[] }[])

  // Merge creatives, dedup by ad_id
  const creativesById = new Map<string, unknown>()
  for (const s of deduped) {
    for (const c of (s.adCreatives ?? []) as Record<string, unknown>[]) {
      const id = c.ad_id as string
      if (id) creativesById.set(id, c)
    }
  }

  const mergedPostIds = Array.from(
    new Set(deduped.flatMap(s => (s.adPostIds as string[] | undefined) ?? []))
  )

  await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange: { from: mergedDaily[0]?.date ?? '', to: mergedDaily[mergedDaily.length - 1]?.date ?? '' },
    conversionType: deduped[0]?.conversionType ?? 'link_click',
    contributorAccounts: deduped.map(s => ({ adAccountId: s.adAccountId, contributorUid: s.contributorUid || '', spend: s.summary?.spend ?? 0 })),
    summary: mergedSummary,
    daily: mergedDaily,
    hourly: mergeHourlyArrays(deduped as { hourly?: HourRow[] }[]),
    adPostIds: mergedPostIds,
    adCreatives: Array.from(creativesById.values()),
  }, { merge: true })
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const tokenSnaps = await adminDb.collectionGroup('metaTokens').get()
    const results: Record<string, unknown>[] = []

    for (const doc of tokenSnaps.docs) {
      if (doc.id === 'userToken') continue
      const uid = doc.ref.parent.parent?.id
      if (!uid) continue
      const tokenData = doc.data() as { userAccessToken?: string; accessToken?: string; igUserId?: string; pageId?: string }
      const pageId = doc.id === 'page' ? (tokenData.pageId ?? '') : doc.id

      const [adsResult, igResult, fbResult, storyResult] = await Promise.all([
        tokenData.userAccessToken && pageId
          ? syncAdsForUser(uid, tokenData.userAccessToken, pageId, tokenData.igUserId)
          : Promise.resolve({ error: 'no userAccessToken' }),
        tokenData.accessToken && tokenData.igUserId && pageId
          ? syncIgForUser(uid, tokenData.accessToken, tokenData.igUserId, pageId)
          : Promise.resolve({ synced: 0, error: 'no accessToken or igUserId' }),
        tokenData.accessToken && pageId
          ? syncFbForUser(uid, tokenData.accessToken, pageId)
          : Promise.resolve({ synced: 0, error: 'no accessToken or pageId' }),
        tokenData.accessToken && tokenData.igUserId && pageId
          ? syncIgStories(uid, tokenData.accessToken, tokenData.igUserId, pageId)
          : Promise.resolve({ synced: 0, error: 'no accessToken or igUserId' }),
      ])

      results.push({ uid, pageId, ads: adsResult, ig: igResult, fb: fbResult, stories: storyResult })
      console.log(`[cron/sync] uid=${uid} pageId=${pageId} ads=`, adsResult, 'ig=', igResult, 'fb=', fbResult, 'stories=', storyResult)
    }

    const pageIdsToMerge = new Set<string>()
    for (const r of results) {
      const ads = r.ads as { adAccountId?: string; error?: string }
      if (r.pageId && ads.adAccountId) pageIdsToMerge.add(r.pageId as string)
    }

    await Promise.all(Array.from(pageIdsToMerge).map(pid => mergePageAdInsights(pid)))

    // Phase 2A: ad-performance alert emails (frequency-aware, deduped). Non-fatal.
    const alertResults = await Promise.all(
      Array.from(pageIdsToMerge).map(async pid => {
        try { return { pageId: pid, ...(await processPageAlerts(pid)) } }
        catch (e) { return { pageId: pid, sent: false, reason: e instanceof Error ? e.message : 'alert error' } }
      })
    )
    console.log('[cron/sync] alerts=', JSON.stringify(alertResults))

    return NextResponse.json({ synced: results.length, results, mergedPages: Array.from(pageIdsToMerge), alerts: alertResults })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/sync] FATAL ERROR:', msg, err)
    return NextResponse.json({ error: 'Internal server error', detail: msg }, { status: 500 })
  }
}
