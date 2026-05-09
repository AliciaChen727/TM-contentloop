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
  postsUrl.searchParams.set('fields', 'id,message,created_time,permalink_url')
  postsUrl.searchParams.set('limit', '50')
  postsUrl.searchParams.set('access_token', accessToken)

  const postsRes = await fetch(postsUrl)
  const postsData = await postsRes.json()
  if (!postsRes.ok || postsData.error) return { synced: 0, error: postsData.error?.message ?? 'posts fetch failed' }

  const posts: { id: string; message?: string; created_time: string; permalink_url?: string }[] = postsData.data ?? []

  // Fetch insights per post in parallel
  const withInsights = await Promise.all(posts.map(async post => {
    try {
      const insUrl = new URL(`${BASE}/${post.id}/insights`)
      insUrl.searchParams.set('metric', 'post_reactions_by_type_total,post_impressions_unique,post_activity_by_action_type')
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
      return { ...post, insights: { reactions, reach: (vals.post_impressions_unique as number) ?? 0, comments: activity.comment ?? 0, shares: activity.share ?? 0 } }
    } catch {
      return { ...post, insights: { reactions: 0, reach: 0, comments: 0, shares: 0 } }
    }
  }))

  const userRef = adminDb.collection('users').doc(uid)
  const batch = adminDb.batch()
  for (const post of withInsights) {
    const postRef = userRef.collection('fbPosts').doc(post.id)
    batch.set(postRef, {
      message: post.message ?? '',
      createdTime: Timestamp.fromDate(new Date(post.created_time)),
      permalink: post.permalink_url ?? '',
      insights: post.insights,
      syncedAt: Timestamp.now(),
    }, { merge: true })
  }
  await batch.commit()
  return { synced: posts.length }
}

// ── IG Posts Sync ─────────────────────────────────────────────────────────────

async function syncIgForUser(uid: string, accessToken: string, igUserId: string): Promise<{ synced: number; error?: string }> {
  const mediaUrl = new URL(`${BASE}/${igUserId}/media`)
  mediaUrl.searchParams.set('fields', 'id,timestamp,caption,media_type,permalink,like_count,comments_count')
  mediaUrl.searchParams.set('limit', '50')
  mediaUrl.searchParams.set('access_token', accessToken)

  const mediaRes = await fetch(mediaUrl)
  const mediaData = await mediaRes.json()
  if (!mediaRes.ok || mediaData.error) return { synced: 0, error: mediaData.error?.message ?? 'media fetch failed' }

  const posts: Record<string, unknown>[] = mediaData.data ?? []

  type IgPost = { id: string; timestamp: string; caption?: string; media_type: string; permalink: string; like_count: number; comments_count: number }

  // Fetch insights per post in parallel (with individual error handling)
  const withInsights = await Promise.all((posts as IgPost[]).map(async post => {
    const isVideo = post.media_type === 'VIDEO' || post.media_type === 'REELS'
    const metrics = isVideo ? 'reach,saved,shares,video_views' : 'reach,saved,shares'
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
  const batch = adminDb.batch()
  for (const post of withInsights) {
    const ins = post._ins
    const postRef = userRef.collection('igPosts').doc(post.id)
    batch.set(postRef, {
      id: post.id,
      caption: post.caption ?? '',
      mediaType: post.media_type,
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

async function syncAdsForUser(uid: string, userAccessToken: string): Promise<{ adAccountId?: string; spend?: number; error?: string }> {
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

  const [summaryRes, dailyRes] = await Promise.all([fetch(summaryUrl), fetch(dailyUrl)])
  const [summaryData, dailyData] = await Promise.all([summaryRes.json(), dailyRes.json()])
  if (!summaryRes.ok || summaryData.error) return { error: summaryData.error?.message ?? 'insights failed' }

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

  const userRef = adminDb.collection('users').doc(uid)
  await userRef.collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange: { from: daily[0]?.date ?? '', to: daily[daily.length - 1]?.date ?? '' },
    adAccountId,
    conversionType,
    summary: { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa },
    daily,
  })

  return { adAccountId, spend }
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
    if (doc.id !== 'page') continue
    const uid = doc.ref.parent.parent?.id
    if (!uid) continue
    const tokenData = doc.data() as { userAccessToken?: string; accessToken?: string; igUserId?: string; pageId?: string }

    const [adsResult, igResult, fbResult] = await Promise.all([
      tokenData.userAccessToken
        ? syncAdsForUser(uid, tokenData.userAccessToken)
        : Promise.resolve({ error: 'no userAccessToken' }),
      tokenData.accessToken && tokenData.igUserId
        ? syncIgForUser(uid, tokenData.accessToken, tokenData.igUserId)
        : Promise.resolve({ synced: 0, error: 'no accessToken or igUserId' }),
      tokenData.accessToken && tokenData.pageId
        ? syncFbForUser(uid, tokenData.accessToken, tokenData.pageId)
        : Promise.resolve({ synced: 0, error: 'no accessToken or pageId' }),
    ])

    results.push({ uid, ads: adsResult, ig: igResult, fb: fbResult })
    console.log(`[cron/sync] uid=${uid} ads=`, adsResult, 'ig=', igResult, 'fb=', fbResult)
  }

  return NextResponse.json({ synced: results.length, results })
}
