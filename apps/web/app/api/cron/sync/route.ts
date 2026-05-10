export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

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

async function syncAdsForUser(uid: string, userAccessToken: string, pageId: string): Promise<{ adAccountId?: string; spend?: number; error?: string }> {
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
  adsUrl.searchParams.set('fields', 'id,name,effective_status,creative{object_story_id}')
  adsUrl.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED"]')
  adsUrl.searchParams.set('limit', '100')
  adsUrl.searchParams.set('access_token', userAccessToken)

  const adLevelUrl = new URL(`${BASE}/${adAccountId}/insights`)
  adLevelUrl.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,ctr,actions,action_values')
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

  const adPostIds: string[] = []
  for (const ad of (adsData.data ?? []) as { id?: string; name?: string; creative?: { object_story_id?: string } }[]) {
    if (ad.creative?.object_story_id) adPostIds.push(ad.creative.object_story_id)
  }

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
  const conversionType = hasPurchase ? 'purchase' : 'video_view'
  const conversions = parseActions(sActions, conversionType)
  const revenue = parseActions(sActionValues, 'purchase')
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0
  const cpa = conversions > 0 ? spend / conversions : 0

  const rawDaily: Record<string, unknown>[] = dailyData.data ?? []
  const daily = rawDaily.map(d => {
    const daySpend = parseFloat((d.spend as string) ?? '0')
    const dayActions: MetaAction[] = (d.actions as MetaAction[]) ?? []
    const dayActionValues: MetaAction[] = (d.action_values as MetaAction[]) ?? []
    const dayConversions = parseActions(dayActions, conversionType)
    const dayRevenue = parseActions(dayActionValues, 'purchase')
    return {
      date: d.date_start as string,
      spend: daySpend,
      reach: parseInt((d.reach as string) ?? '0'),
      impressions: parseInt((d.impressions as string) ?? '0'),
      clicks: parseInt((d.clicks as string) ?? '0'),
      ctr: parseFloat((d.ctr as string) ?? '0'),
      roas: daySpend > 0 && dayRevenue > 0 ? dayRevenue / daySpend : 0,
      conversions: dayConversions,
      revenue: dayRevenue,
    }
  })

  const rawHourly: Record<string, unknown>[] = hourlyData.data ?? []
  const hourly = rawHourly.map(h => {
    const hourSpend = parseFloat((h.spend as string) ?? '0')
    const hourActionValues: MetaAction[] = (h.action_values as MetaAction[]) ?? []
    const hourRevenue = parseActions(hourActionValues, 'purchase')
    const hourLabel = (h.hourly_stats_aggregated_by_advertiser_time_zone as string) ?? '0:00 - 1:00'
    return {
      hour: parseInt(hourLabel.split(':')[0]),
      spend: hourSpend,
      roas: hourSpend > 0 && hourRevenue > 0 ? hourRevenue / hourSpend : 0,
    }
  }).sort((a, b) => a.hour - b.hour)

  // Merge ads list with insights: show all ads even if spend=0
  const insightsByAdId = new Map<string, Record<string, unknown>>()
  for (const item of (adLevelData.data ?? []) as Record<string, unknown>[]) {
    if (typeof item.ad_id === 'string') insightsByAdId.set(item.ad_id, item)
  }
  const adsList: { id: string; name: string }[] = adsData.data ?? []
  const adCreatives: Record<string, unknown>[] = adsList.length > 0
    ? adsList.map(ad => insightsByAdId.get(ad.id) ?? { ad_id: ad.id, ad_name: ad.name, spend: '0', impressions: '0', ctr: '0', actions: [], action_values: [] })
    : (adLevelData.data ?? [])

  const userRef = adminDb.collection('users').doc(uid)
  const dateRange = { from: daily[0]?.date ?? '', to: daily[daily.length - 1]?.date ?? '' }
  const summaryDoc = { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa }

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
  })

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
  })

  return { adAccountId, spend }
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
    roas:      spend > 0 && revenue > 0 ? revenue / spend : 0,
    frequency: reach > 0 ? impressions / reach : 0,
  }
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
      roas: e.spend > 0 && e.revenue > 0 ? e.revenue / e.spend : 0,
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

  await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange: { from: mergedDaily[0]?.date ?? '', to: mergedDaily[mergedDaily.length - 1]?.date ?? '' },
    conversionType: deduped[0]?.conversionType ?? 'video_view',
    contributorAccounts: deduped.map(s => ({ adAccountId: s.adAccountId, contributorUid: s.contributorUid, spend: s.summary?.spend ?? 0 })),
    summary: mergedSummary,
    daily: mergedDaily,
    adCreatives: Array.from(creativesById.values()),
  })
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokenSnaps = await adminDb.collectionGroup('metaTokens').get()
  const results: Record<string, unknown>[] = []

  for (const doc of tokenSnaps.docs) {
    // Skip user-level token and legacy 'page' doc (now handled by per-page docs)
    if (doc.id === 'userToken') continue
    const uid = doc.ref.parent.parent?.id
    if (!uid) continue
    const tokenData = doc.data() as { userAccessToken?: string; accessToken?: string; igUserId?: string; pageId?: string }

    // For new-style docs: doc.id is the pageId
    // For legacy 'page' doc: use tokenData.pageId
    const pageId = doc.id === 'page' ? (tokenData.pageId ?? '') : doc.id

    const [adsResult, igResult, fbResult] = await Promise.all([
      tokenData.userAccessToken && pageId
        ? syncAdsForUser(uid, tokenData.userAccessToken, pageId)
        : Promise.resolve({ error: 'no userAccessToken' }),
      tokenData.accessToken && tokenData.igUserId && pageId
        ? syncIgForUser(uid, tokenData.accessToken, tokenData.igUserId, pageId)
        : Promise.resolve({ synced: 0, error: 'no accessToken or igUserId' }),
      tokenData.accessToken && pageId
        ? syncFbForUser(uid, tokenData.accessToken, pageId)
        : Promise.resolve({ synced: 0, error: 'no accessToken or pageId' }),
    ])

    results.push({ uid, pageId, ads: adsResult, ig: igResult, fb: fbResult })
    console.log(`[cron/sync] uid=${uid} pageId=${pageId} ads=`, adsResult, 'ig=', igResult, 'fb=', fbResult)
  }

  // After all per-user syncs, merge ad insights for each page that had a successful ad sync
  const pageIdsToMerge = new Set<string>()
  for (const r of results) {
    const ads = r.ads as { adAccountId?: string; error?: string }
    if (r.pageId && ads.adAccountId) pageIdsToMerge.add(r.pageId as string)
  }
  await Promise.all(Array.from(pageIdsToMerge).map(pid => mergePageAdInsights(pid)))

  return NextResponse.json({ synced: results.length, results, mergedPages: Array.from(pageIdsToMerge) })
}
