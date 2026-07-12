export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { computeDiagnosisFromSnapshot } from '@/lib/ads/diagnosis'
import { fetchPageFollowerStats } from '@/lib/meta/fetchPageFollowerStats'
import { syncIgStories } from '@/lib/meta/igStories'
import { parseActionValue as parseActions, hasPurchaseAction, type MetaAction } from '@/lib/meta/purchaseActions'
import { computeCreativeFingerprint } from '@/lib/ads/creativeFingerprint'
import { syncThreadsForPage } from '@/lib/threads/sync'

const BASE = 'https://graph.facebook.com/v19.0'

// ── FB Posts Sync ─────────────────────────────────────────────────────────────

async function syncFbForUser(uid: string, accessToken: string, pageId: string): Promise<{ synced: number; error?: string }> {
  const postsUrl = new URL(`${BASE}/${pageId}/posts`)
  postsUrl.searchParams.set('fields', 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares')
  postsUrl.searchParams.set('limit', '100')
  postsUrl.searchParams.set('access_token', accessToken)

  const postsRes = await fetch(postsUrl)
  const postsData = await postsRes.json()
  if (!postsRes.ok || postsData.error) return { synced: 0, error: postsData.error?.message ?? 'posts fetch failed' }

  type RawPost = { id: string; message?: string; story?: string; created_time: string; permalink_url?: string; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }
  const allPosts: RawPost[] = postsData.data ?? []

  // Posts with user-written text → save; story-only / empty → delete from Firestore
  const posts = allPosts.filter(p => p.message)
  const storyOnlyIds = allPosts.filter(p => !p.message).map(p => p.id)

  // Engagement (reactions/comments/shares) comes from the plain /posts fields above —
  // reliable and available immediately, even for brand-new posts. The per-post /insights
  // call is ONLY for reach (impressions), which lags and often errors on fresh posts.
  // A failure there must NEVER zero engagement.
  //
  // ⚠️ Root cause of the recurring "new FB posts show 0 likes/comments/shares": cron
  // used to derive engagement from /insights metrics (post_reactions_by_type_total /
  // post_activity_by_action_type). Those are empty/erroring for a day-old post → wrote 0.
  // The earlier read-then-max fix only stopped cron from WIPING posts that already had
  // numbers; a fresh post has no prev value to max against, so it stuck at 0. Now cron
  // reads the same reliable plain fields the manual sync uses.
  const withInsights = await Promise.all(posts.map(async post => {
    const reactions = post.reactions?.summary?.total_count ?? 0
    const comments = post.comments?.summary?.total_count ?? 0
    const shares = post.shares?.count ?? 0
    // Reach: Meta REMOVED the whole post_impressions_* family on 2026-06-15 (all
    // API versions) → those metrics now return #100 "not a valid insights metric".
    // Replacement = the new "views" family: `post_media_view` = total views
    // (impressions-like). ⚠️ The unique/reach variant (post_media_view_unique) is
    // no longer offered at post level, so this is VIEWS (can exceed unique reach),
    // not unique reach. Confirmed working on v19–v22. Old code silently swallowed
    // the #100 (no error check) → reach stuck at 0 for months; now we log it.
    let reach = 0
    try {
      const insUrl = new URL(`${BASE}/${post.id}/insights`)
      insUrl.searchParams.set('metric', 'post_media_view')
      insUrl.searchParams.set('period', 'lifetime')
      insUrl.searchParams.set('access_token', accessToken)
      const insRes = await fetch(insUrl)
      const insData = await insRes.json()
      if (insData.error) {
        console.warn(`[cron/sync] FB post_media_view error for ${post.id}:`, JSON.stringify(insData.error))
      } else {
        for (const item of (insData.data ?? []) as { name: string; values: { value: unknown }[] }[]) {
          if (item.name === 'post_media_view') reach = (item.values?.[0]?.value as number) ?? 0
        }
      }
    } catch (e) {
      console.warn(`[cron/sync] FB insights exception for ${post.id}:`, e)
    }
    return { ...post, insights: { reactions, reach, comments, shares } }
  }))

  const userRef = adminDb.collection('users').doc(uid)
  const fbPostsCol = userRef.collection('pages').doc(pageId).collection('fbPosts')

  // Read existing docs first so a flaky per-post /insights call (which falls back to
  // all-zeros in the catch above) can never WIPE previously-synced engagement. Same
  // read-then-max guarantee the manual sync already has (commit b414e9c) — without it,
  // a single bad cron run zeroes out every page's real numbers.
  const existingSnaps = withInsights.length > 0
    ? await adminDb.getAll(...withInsights.map(p => fbPostsCol.doc(p.id)))
    : []
  const prevInsightsById = new Map<string, Record<string, number>>()
  for (const snap of existingSnaps) {
    if (snap.exists) prevInsightsById.set(snap.id, (snap.data()?.insights ?? {}) as Record<string, number>)
  }
  const maxMerge = (prev: Record<string, number>, next: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = { ...prev }
    for (const [k, v] of Object.entries(next)) {
      if (typeof v === 'number') out[k] = Math.max(out[k] ?? 0, v)
    }
    return out
  }

  const batch = adminDb.batch()
  for (const post of withInsights) {
    const postRef = fbPostsCol.doc(post.id)
    batch.set(postRef, {
      message: post.message ?? '',
      createdTime: Timestamp.fromDate(new Date(post.created_time)),
      permalink: post.permalink_url ?? '',
      insights: maxMerge(prevInsightsById.get(post.id) ?? {}, post.insights),
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

// One ad account's page-filtered slice: only ads whose creative belongs to this
// page (story-id prefix / IG actor) count. This is THE fix for the cross-page
// contamination bug (2026-07-12): the old code stored level=account rollups, so
// a shared ad account leaked other pages' spend into this page's snapshot.
async function aggregateAccountForPage(
  accountId: string, userAccessToken: string, pageId: string, igUserId?: string,
): Promise<{
  pageAdsList: { id: string; name: string; creative?: { object_story_id?: string; effective_object_story_id?: string; effective_instagram_story_id?: string; instagram_actor_id?: string } }[]
  dailyRows: Record<string, unknown>[]
  hourlyRows: Record<string, unknown>[]
  adLevelItems: Record<string, unknown>[]
} | { error: string }> {
  const adsUrl = new URL(`${BASE}/${accountId}/ads`)
  adsUrl.searchParams.set('fields', 'id,name,effective_status,effective_object_story_id,creative{object_story_id,effective_object_story_id,effective_instagram_story_id,instagram_actor_id}')
  adsUrl.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED"]')
  adsUrl.searchParams.set('limit', '100')
  adsUrl.searchParams.set('access_token', userAccessToken)

  const dailyAdUrl = new URL(`${BASE}/${accountId}/insights`)
  dailyAdUrl.searchParams.set('fields', 'ad_id,spend,reach,impressions,clicks,actions,action_values')
  dailyAdUrl.searchParams.set('date_preset', 'last_30d')
  dailyAdUrl.searchParams.set('time_increment', '1')
  dailyAdUrl.searchParams.set('level', 'ad')
  dailyAdUrl.searchParams.set('limit', '1000')
  dailyAdUrl.searchParams.set('access_token', userAccessToken)

  const adLevelUrl = new URL(`${BASE}/${accountId}/insights`)
  adLevelUrl.searchParams.set('fields', 'ad_id,ad_name,spend,reach,impressions,ctr,actions,action_values')
  adLevelUrl.searchParams.set('date_preset', 'last_30d')
  adLevelUrl.searchParams.set('level', 'ad')
  adLevelUrl.searchParams.set('limit', '200')
  adLevelUrl.searchParams.set('access_token', userAccessToken)

  const hourlyUrl = new URL(`${BASE}/${accountId}/insights`)
  hourlyUrl.searchParams.set('fields', 'ad_id,spend,actions,action_values')
  hourlyUrl.searchParams.set('date_preset', 'last_30d')
  hourlyUrl.searchParams.set('level', 'ad')
  hourlyUrl.searchParams.set('breakdowns', 'hourly_stats_aggregated_by_advertiser_time_zone')
  hourlyUrl.searchParams.set('limit', '1000')
  hourlyUrl.searchParams.set('access_token', userAccessToken)

  const [adsRes, dailyRes, adLevelRes, hourlyRes] = await Promise.all([fetch(adsUrl), fetch(dailyAdUrl), fetch(adLevelUrl), fetch(hourlyUrl)])
  const [adsData, dailyData, adLevelData, hourlyData] = await Promise.all([adsRes.json(), dailyRes.json(), adLevelRes.json(), hourlyRes.json()])
  if (!adsRes.ok || adsData.error) return { error: adsData.error?.message ?? 'ads fetch failed' }
  if (!dailyRes.ok || dailyData.error) return { error: dailyData.error?.message ?? 'daily ad insights failed' }
  if (!adLevelRes.ok || adLevelData.error) return { error: adLevelData.error?.message ?? 'ad-level insights failed' }

  // Strict page filter: never fall back to all-account ads.
  const rawAdsList: { id: string; name: string; creative?: { object_story_id?: string; effective_object_story_id?: string; effective_instagram_story_id?: string; instagram_actor_id?: string } }[] = adsData.data ?? []
  const pageAdsList = rawAdsList.filter(ad => {
    const sid = ad.creative?.object_story_id ?? ad.creative?.effective_object_story_id
    if (sid?.startsWith(pageId + '_')) return true
    if (igUserId && ad.creative?.instagram_actor_id === igUserId) return true
    return false
  })
  const pageAdIds = new Set(pageAdsList.map(a => a.id))
  const byPage = (rows: Record<string, unknown>[]) => rows.filter(r => pageAdIds.has(r.ad_id as string))
  return {
    pageAdsList,
    dailyRows: byPage(dailyData.data ?? []),
    hourlyRows: byPage((hourlyData?.data ?? []) as Record<string, unknown>[]),
    adLevelItems: byPage(adLevelData.data ?? []),
  }
}

async function syncAdsForUser(uid: string, userAccessToken: string, pageId: string, igUserId?: string): Promise<{ adAccountId?: string; spend?: number; reach?: number; conversionType?: string; linkClicks?: number; videoViews?: number; pageAdsCount?: number; error?: string }> {
  const accountsUrl = new URL(`${BASE}/me/adaccounts`)
  accountsUrl.searchParams.set('fields', 'id,name')
  accountsUrl.searchParams.set('access_token', userAccessToken)
  const accountsRes = await fetch(accountsUrl)
  const accountsData = await accountsRes.json()
  if (!accountsRes.ok || accountsData.error) return { error: accountsData.error?.message ?? 'get adaccounts failed' }

  const accounts: { id: string }[] = accountsData.data ?? []
  if (!accounts.length) return { error: 'no ad accounts' }

  // Page-filtered slice of EVERY visible account — a page's campaigns can span
  // multiple accounts, and a shared account must never leak other pages' spend.
  const slices = await Promise.all(accounts.map(async a => ({ accountId: a.id, result: await aggregateAccountForPage(a.id, userAccessToken, pageId, igUserId) })))
  const okSlices = slices.filter((s): s is { accountId: string; result: Exclude<Awaited<ReturnType<typeof aggregateAccountForPage>>, { error: string }> } => !('error' in s.result))
  if (okSlices.length === 0) {
    const firstErr = slices.find(s => 'error' in s.result)
    return { error: (firstErr?.result as { error: string } | undefined)?.error ?? 'all accounts failed' }
  }

  const withAds = okSlices.filter(s => s.result.pageAdsList.length > 0)
  const pageAdsList = withAds.flatMap(s => s.result.pageAdsList)
  const allDailyRows = withAds.flatMap(s => s.result.dailyRows)
  const allHourlyRows = withAds.flatMap(s => s.result.hourlyRows)
  const adPostIds: string[] = pageAdsList.map(ad => (ad.creative?.object_story_id ?? ad.creative?.effective_object_story_id) || ad.creative?.effective_instagram_story_id).filter(Boolean) as string[]

  // Shared aggregation: page-filtered rows → summary/daily/hourly/creatives, in
  // the exact shapes the dashboards and mergePageAdInsights already consume.
  const buildAgg = (
    dailyRows: Record<string, unknown>[], hourlyRows: Record<string, unknown>[],
    adLevelItems: Record<string, unknown>[], ads: typeof pageAdsList,
  ) => {
    const hasPurchase = dailyRows.some(r => hasPurchaseAction((r.actions as MetaAction[]) ?? []))
    const sumActs = (key: 'actions' | 'action_values', type: string) =>
      dailyRows.reduce((s, r) => s + parseActions((r[key] as MetaAction[]) ?? [], type), 0)
    const linkClicks = sumActs('actions', 'link_click')
    const videoViews = sumActs('actions', 'video_view')
    const conversionType = hasPurchase ? 'purchase' : linkClicks > 0 ? 'link_click' : videoViews > 0 ? 'video_view' : 'link_click'

    const byDate = new Map<string, { spend: number; reach: number; impressions: number; clicks: number; conversions: number; revenue: number }>()
    for (const r of dailyRows) {
      const date = r.date_start as string
      if (!date) continue
      const e = byDate.get(date) ?? { spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
      e.spend += parseFloat((r.spend as string) ?? '0')
      e.reach += parseInt((r.reach as string) ?? '0')
      e.impressions += parseInt((r.impressions as string) ?? '0')
      e.clicks += parseInt((r.clicks as string) ?? '0')
      const acts = (r.actions as MetaAction[]) ?? []
      const actVals = (r.action_values as MetaAction[]) ?? []
      const dayPrimary = hasPurchase ? parseActions(actVals, 'purchase')
        : linkClicks > 0 ? parseActions(acts, 'link_click')
        : parseActions(acts, 'video_view')
      e.conversions += dayPrimary
      e.revenue += dayPrimary
      byDate.set(date, e)
    }
    const daily = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, e]) => ({
      date, spend: e.spend, reach: e.reach, impressions: e.impressions, clicks: e.clicks,
      ctr: e.impressions > 0 ? parseFloat((e.clicks / e.impressions * 100).toFixed(4)) : 0,
      roas: e.spend > 0 && e.conversions > 0
        ? (hasPurchase ? parseFloat((e.revenue / e.spend).toFixed(2)) : parseFloat((e.conversions / e.spend * 100).toFixed(2)))
        : 0,
      conversions: e.conversions, revenue: e.revenue,
    }))

    const spend = daily.reduce((s, d) => s + d.spend, 0)
    const reach = daily.reduce((s, d) => s + d.reach, 0)
    const impressions = daily.reduce((s, d) => s + d.impressions, 0)
    const clicks = daily.reduce((s, d) => s + d.clicks, 0)
    const conversions = daily.reduce((s, d) => s + d.conversions, 0)
    const revenue = daily.reduce((s, d) => s + d.revenue, 0)
    const summaryDoc = {
      spend, reach, impressions, clicks,
      ctr: impressions > 0 ? parseFloat((clicks / impressions * 100).toFixed(4)) : 0,
      cpm: impressions > 0 ? parseFloat((spend / impressions * 1000).toFixed(2)) : 0,
      frequency: reach > 0 ? parseFloat((impressions / reach).toFixed(2)) : 0,
      conversions, revenue,
      roas: spend > 0 && conversions > 0
        ? (hasPurchase ? parseFloat((revenue / spend).toFixed(2)) : parseFloat((conversions / spend * 100).toFixed(2)))
        : 0,
      cpa: conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : 0,
      conversionType, linkClicks, videoViews,
    }

    const byHour = new Map<number, { spend: number; primary: number }>()
    for (const r of hourlyRows) {
      const hourLabel = (r.hourly_stats_aggregated_by_advertiser_time_zone as string) ?? '0:00 - 1:00'
      const hour = parseInt(hourLabel.split(':')[0])
      const acts = (r.actions as MetaAction[]) ?? []
      const actVals = (r.action_values as MetaAction[]) ?? []
      const primary = hasPurchase ? parseActions(actVals, 'purchase')
        : linkClicks > 0 ? parseActions(acts, 'link_click')
        : parseActions(acts, 'video_view')
      const e = byHour.get(hour) ?? { spend: 0, primary: 0 }
      e.spend += parseFloat((r.spend as string) ?? '0')
      e.primary += primary
      byHour.set(hour, e)
    }
    const hourly = Array.from(byHour.entries()).sort(([a], [b]) => a - b).map(([hour, e]) => ({
      hour, spend: e.spend,
      roas: e.spend > 0 && e.primary > 0
        ? (hasPurchase ? parseFloat((e.primary / e.spend).toFixed(2)) : parseFloat((e.primary / e.spend * 100).toFixed(2)))
        : 0,
    }))

    // Show all page ads even if spend=0 in the window.
    const insightsByAdId = new Map<string, Record<string, unknown>>()
    for (const item of adLevelItems) { if (typeof item.ad_id === 'string') insightsByAdId.set(item.ad_id, item) }
    const adCreatives: Record<string, unknown>[] = ads.map(ad =>
      insightsByAdId.get(ad.id) ?? { ad_id: ad.id, ad_name: ad.name, spend: '0', impressions: '0', ctr: '0', actions: [], action_values: [] })

    return { summaryDoc, daily, hourly, adCreatives, conversionType, spend, reach, linkClicks, videoViews }
  }

  const combined = buildAgg(allDailyRows, allHourlyRows, withAds.flatMap(s => s.result.adLevelItems), pageAdsList)
  const userRef = adminDb.collection('users').doc(uid)
  const dateRange = { from: combined.daily[0]?.date ?? '', to: combined.daily[combined.daily.length - 1]?.date ?? '' }
  const adAccountIdJoined = withAds.map(s => s.accountId).join(',')

  // UID-scoped write (backward compat + fallback) — now page-filtered.
  await userRef.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange,
    adAccountId: adAccountIdJoined,
    conversionType: combined.conversionType,
    summary: combined.summaryDoc,
    daily: combined.daily,
    hourly: combined.hourly,
    adPostIds,
    adCreatives: combined.adCreatives,
    creativeFingerprint: computeCreativeFingerprint(combined.adCreatives),
  }, { merge: true })

  // Shared per-account snapshots: one page-filtered slice per account. Visible
  // accounts with NO ads for this page get their snapshot DELETED — self-heals
  // the zombie docs behind the 2026-07 cross-page contamination.
  await Promise.all(okSlices.map(async ({ accountId, result }) => {
    const ref = adminDb.collection('pages').doc(pageId).collection('adAccountSnapshots').doc(accountId)
    if (result.pageAdsList.length === 0) {
      await ref.delete().catch(() => {})
      return
    }
    const agg = buildAgg(result.dailyRows, result.hourlyRows, result.adLevelItems, result.pageAdsList)
    await ref.set({
      adAccountId: accountId,
      contributorUid: uid,
      syncedAt: Timestamp.now(),
      dateRange: { from: agg.daily[0]?.date ?? '', to: agg.daily[agg.daily.length - 1]?.date ?? '' },
      conversionType: agg.conversionType,
      summary: agg.summaryDoc,
      daily: agg.daily,
      hourly: agg.hourly,
      adCreatives: agg.adCreatives,
    })
  }))

  return { adAccountId: adAccountIdJoined, spend: combined.spend, reach: combined.reach, conversionType: combined.conversionType, linkClicks: combined.linkClicks, videoViews: combined.videoViews, pageAdsCount: pageAdsList.length }
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
  if (snapsSnap.empty) {
    // Empty is affirmative: every visible account was scanned and none carries
    // this page's ads (zombie snapshots get deleted in syncAdsForUser). Zero the
    // shared ad fields so stale contaminated data can't survive. Sync FAILURES
    // never delete snapshots, so a broken token can't trigger this wipe.
    const zeroSummary = { spend: 0, reach: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0, frequency: 0, conversions: 0, revenue: 0, roas: 0, cpa: 0 }
    const diag = computeDiagnosisFromSnapshot({ summary: zeroSummary, adCreatives: [] })
    await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
      syncedAt: Timestamp.now(),
      dateRange: { from: '', to: '' },
      contributorAccounts: [],
      summary: zeroSummary,
      daily: [],
      hourly: [],
      adPostIds: [],
      adCreatives: [],
      diagnosis: diag.items,
      diagnosisCounts: { critical: diag.criticalCount, warning: diag.warningCount },
      diagnosisUpdatedAt: Timestamp.now(),
    }, { merge: true })
    return
  }

  // Dedup by adAccountId: latest syncedAt wins (compare millis — relational
  // operators on Timestamp objects fall back to string comparison).
  const tsMillis = (d: FirebaseFirestore.DocumentData) => (d.syncedAt as Timestamp | undefined)?.toMillis?.() ?? 0
  const byAccount = new Map<string, FirebaseFirestore.DocumentData>()
  for (const doc of snapsSnap.docs) {
    const data = doc.data()
    const existing = byAccount.get(data.adAccountId)
    if (!existing || tsMillis(data) > tsMillis(existing)) byAccount.set(data.adAccountId, data)
  }
  // Staleness guard: a snapshot no cron refreshed in 14 days is a zombie (its
  // account is no longer visible to any contributor, or all their tokens broke).
  // Zombie snapshots caused the 2026-07 cross-page contamination — never merge
  // them. If EVERYTHING is stale, keep the existing doc rather than wiping it.
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const deduped = Array.from(byAccount.values()).filter(s => tsMillis(s) >= cutoff)
  if (deduped.length === 0) return

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

  const mergedCreatives = Array.from(creativesById.values())
  // Compute + store diagnosis from the same inputs the 診斷建議 page uses, so the
  // in-app 紅點 / email / dashboard all share one rule engine. Refreshed each sync.
  const diag = computeDiagnosisFromSnapshot({ summary: mergedSummary, adCreatives: mergedCreatives })

  await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange: { from: mergedDaily[0]?.date ?? '', to: mergedDaily[mergedDaily.length - 1]?.date ?? '' },
    conversionType: deduped[0]?.conversionType ?? 'link_click',
    contributorAccounts: deduped.map(s => ({ adAccountId: s.adAccountId, contributorUid: s.contributorUid || '', spend: s.summary?.spend ?? 0 })),
    summary: mergedSummary,
    daily: mergedDaily,
    hourly: mergeHourlyArrays(deduped as { hourly?: HourRow[] }[]),
    adPostIds: mergedPostIds,
    adCreatives: mergedCreatives,
    creativeFingerprint: computeCreativeFingerprint(mergedCreatives),
    diagnosis: diag.items,
    diagnosisCounts: { critical: diag.criticalCount, warning: diag.warningCount },
    diagnosisUpdatedAt: Timestamp.now(),
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

    // Threads (separate OAuth/token) — sync every connected page's Threads too.
    let threadsSynced = 0
    try {
      const threadsTokens = await adminDb.collectionGroup('threadsTokens').get()
      for (const doc of threadsTokens.docs) {
        const uid = doc.ref.parent.parent?.id
        const pageId = doc.id
        if (!uid || !pageId) continue
        const r = await syncThreadsForPage(uid, pageId).catch(() => ({ ok: false }))
        if (r.ok) threadsSynced++
      }
    } catch (e) { console.error('[cron/sync] threads sync error', e) }

    // Alert emails are decoupled: sent on a per-page schedule by
    // /api/cron/send-alerts (hourly). Sync only refreshes data here.

    return NextResponse.json({ synced: results.length, results, mergedPages: Array.from(pageIdsToMerge), threadsSynced })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/sync] FATAL ERROR:', msg, err)
    return NextResponse.json({ error: 'Internal server error', detail: msg }, { status: 500 })
  }
}
