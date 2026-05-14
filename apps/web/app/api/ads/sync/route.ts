export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const BASE = 'https://graph.facebook.com/v19.0'

type MetaAction = { action_type: string; value: string }

function parseActions(actions: MetaAction[], type: string): number {
  return parseFloat(actions.find(a => a.action_type === type)?.value ?? '0')
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  try {
  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  const since: string | undefined = body.since
  const until: string | undefined = body.until

  const userRef = adminDb.collection('users').doc(uid)
  // Try new per-page token doc, fallback to legacy 'page' doc
  const tokenDocRef = pageId
    ? userRef.collection('metaTokens').doc(pageId)
    : userRef.collection('metaTokens').doc('page')
  const tokenDoc = await tokenDocRef.get()
  if (!tokenDoc.exists) {
    return NextResponse.json({ error: 'No Meta token. Please reconnect.' }, { status: 400 })
  }

  const { userAccessToken, storyIdPrefix, igUserId } = tokenDoc.data() as { userAccessToken?: string; storyIdPrefix?: string; igUserId?: string }
  if (!userAccessToken) {
    return NextResponse.json({ error: 'No user access token. Please reconnect Meta to grant ads_read.' }, { status: 400 })
  }
  // storyIdPrefix: optional override for pages that migrated to New Page Experience.
  // The page's /me/accounts ID may differ from the old ID used in effective_object_story_id.
  const effectivePagePrefix = storyIdPrefix ?? pageId

  // Always use /me/adaccounts — page isolation is handled by effective_object_story_id filtering.
  // Using /{pageId}/adaccounts can return a different (empty) account than the shared account
  // that actually contains the campaigns for both D67 and Legacy pages.
  const accountsUrl = new URL(`${BASE}/me/adaccounts`)
  accountsUrl.searchParams.set('fields', 'id,name')
  accountsUrl.searchParams.set('access_token', userAccessToken)
  const accountsRes = await fetch(accountsUrl)
  const accountsData = await accountsRes.json()
  if (!accountsRes.ok || accountsData.error) {
    return NextResponse.json({ error: accountsData.error?.message ?? 'Failed to get ad accounts' }, { status: 500 })
  }
  const accounts: { id: string; name: string }[] = accountsData.data ?? []
  if (!accounts.length) {
    return NextResponse.json({ error: 'No ad accounts found under this user.' }, { status: 400 })
  }
  const adAccountId = accounts[0].id

  const insightFields = 'spend,reach,impressions,clicks,ctr,cpm,frequency,actions,action_values'

  // Fetch summary, daily, and per-ad insights in parallel
  const dateRange = since && until
    ? { time_range: JSON.stringify({ since, until }) }
    : { date_preset: 'last_30d' }

  const summaryUrl = new URL(`${BASE}/${adAccountId}/insights`)
  summaryUrl.searchParams.set('fields', insightFields)
  Object.entries(dateRange).forEach(([k, v]) => summaryUrl.searchParams.set(k, v))
  summaryUrl.searchParams.set('level', 'account')
  summaryUrl.searchParams.set('access_token', userAccessToken)

  const dailyUrl = new URL(`${BASE}/${adAccountId}/insights`)
  dailyUrl.searchParams.set('fields', insightFields)
  Object.entries(dateRange).forEach(([k, v]) => dailyUrl.searchParams.set(k, v))
  dailyUrl.searchParams.set('time_increment', '1')
  dailyUrl.searchParams.set('level', 'account')
  dailyUrl.searchParams.set('access_token', userAccessToken)

  // Fetch summary + daily from accounts[0] (aggregate stats).
  // Fetch per-ad insights (date-range + all-time) and ads list across ALL accounts —
  // ads created by other admins may live in a different ad account.
  const [[summaryRes, dailyRes], adsListResArray, adLevelResArray, allTimeResArray] = await Promise.all([
    Promise.all([fetch(summaryUrl), fetch(dailyUrl)]),
    Promise.all(accounts.map(account => {
      const url = new URL(`${BASE}/${account.id}/ads`)
      url.searchParams.set('fields', 'id,name,effective_status,effective_object_story_id,creative{object_story_id,effective_object_story_id,effective_instagram_story_id,instagram_story_id,source_instagram_media_id}')
      url.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED","CAMPAIGN_PAUSED","ADSET_PAUSED","WITH_ISSUES","IN_PROCESS","DELETED"]')
      url.searchParams.set('limit', '100')
      url.searchParams.set('access_token', userAccessToken)
      return fetch(url)
    })),
    Promise.all(accounts.map(account => {
      const url = new URL(`${BASE}/${account.id}/insights`)
      url.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,ctr,actions,action_values,effective_object_story_id')
      Object.entries(dateRange).forEach(([k, v]) => url.searchParams.set(k, v))
      url.searchParams.set('level', 'ad')
      url.searchParams.set('limit', '200')
      url.searchParams.set('access_token', userAccessToken)
      return fetch(url)
    })),
    Promise.all(accounts.map(account => {
      const url = new URL(`${BASE}/${account.id}/insights`)
      url.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,ctr,actions,action_values')
      url.searchParams.set('date_preset', 'maximum')
      url.searchParams.set('level', 'ad')
      url.searchParams.set('limit', '200')
      url.searchParams.set('access_token', userAccessToken)
      return fetch(url)
    })),
  ])
  const [summaryData, dailyData] = await Promise.all([summaryRes.json(), dailyRes.json()])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adsListArrays = await Promise.all(adsListResArray.map(r => r.json()))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adsListData = { data: adsListArrays.flatMap((d: any) => (d.data ?? []) as Record<string, unknown>[]) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adLevelArrays = await Promise.all(adLevelResArray.map(r => r.json()))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adLevelData = { data: adLevelArrays.flatMap((d: any) => (d.data ?? []) as Record<string, unknown>[]) }
  const allTimeArrays = await Promise.all(allTimeResArray.map(r => r.json()))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adLevelAllTimeData = { data: allTimeArrays.flatMap((d: any) => (d.data ?? []) as Record<string, unknown>[]) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTimeErrors = allTimeArrays.filter((d: any) => d.error).map((d: any) => d.error?.message)

  if (!summaryRes.ok || summaryData.error) {
    return NextResponse.json({ error: summaryData.error?.message ?? 'Failed to get insights' }, { status: 500 })
  }

  // Parse summary
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

  // Determine conversion type: prefer purchase, fallback to video_view
  const hasPurchase = sActions.some(a => a.action_type === 'purchase')
  const conversionType = hasPurchase ? 'purchase' : 'video_view'
  const conversions = parseActions(sActions, conversionType)
  const revenue = parseActions(sActionValues, 'purchase')
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0
  const cpa = conversions > 0 ? spend / conversions : 0

  // Parse daily
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

  const dateFrom = daily[0]?.date ?? ''
  const dateTo = daily[daily.length - 1]?.date ?? ''

  // Merge: date-range insights → 90d insights (reliable storyId) → bare stub
  const insightsByAdId = new Map<string, Record<string, unknown>>()
  for (const item of (adLevelData.data ?? []) as Record<string, unknown>[]) {
    if (typeof item.ad_id === 'string') insightsByAdId.set(item.ad_id, item)
  }
  const adLevelAllTime: Record<string, unknown>[] = (adLevelAllTimeData.data ?? []) as Record<string, unknown>[]
  const allTimeByAdId = new Map<string, Record<string, unknown>>()
  for (const item of adLevelAllTime) {
    if (typeof item.ad_id === 'string') allTimeByAdId.set(item.ad_id as string, item)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adsList: { id: string; name: string; effective_status: string; effective_object_story_id?: string; creative?: { object_story_id?: string; effective_object_story_id?: string; effective_instagram_story_id?: string; instagram_story_id?: string; source_instagram_media_id?: string } }[] = (adsListData.data ?? []) as any
  const adIdToStoryId = new Map<string, string>()
  const adIdToIgStoryId = new Map<string, string>()
  for (const ad of adsList) {
    const sid = ad.effective_object_story_id
      ?? ad.creative?.effective_object_story_id
      ?? ad.creative?.object_story_id
      ?? ad.creative?.effective_instagram_story_id
      ?? ad.creative?.instagram_story_id
    if (ad.id && sid) adIdToStoryId.set(ad.id, sid)
    const igId = ad.creative?.effective_instagram_story_id ?? ad.creative?.instagram_story_id ?? ad.creative?.source_instagram_media_id
    if (ad.id && igId) adIdToIgStoryId.set(ad.id, igId)
  }
  const allAdCreatives: Record<string, unknown>[] = adsList.length > 0
    ? adsList.map(ad => {
        const dateRangeItem = insightsByAdId.get(ad.id)
        const allTimeItem = allTimeByAdId.get(ad.id)
        // Prefer date-range only if it has real spend; otherwise fall back to all-time
        let item = (dateRangeItem && parseFloat(dateRangeItem.spend as string ?? '0') > 0) ? dateRangeItem
          : allTimeItem ? allTimeItem
          : dateRangeItem ? dateRangeItem  // date-range exists but spend=0
          : { ad_id: ad.id, ad_name: ad.name, spend: '0', impressions: '0', ctr: '0', actions: [], action_values: [] }
        
        const storyId = adIdToStoryId.get(ad.id)
        if (storyId && !item.effective_object_story_id) {
          item = { ...item, effective_object_story_id: storyId }
        }
        return item
      })
    : (adLevelData.data ?? [])

  // Load known IG media IDs from Firestore early to catch cross-account and cross-format ads.
  // Handles two cases: (A) fbPageId_igMediaId format (Meta Ads Manager cross-posts),
  // (B) oldIgUserId_igMediaId format (boosts from a previously linked IG account).
  let igMediaIdSet = new Set<string>()
  if (pageId) {
    try {
      const igPostsSnap = await userRef.collection('pages').doc(pageId).collection('igPosts').get()
      igMediaIdSet = new Set(igPostsSnap.docs.map(d => d.id))
    } catch { /* non-critical */ }
  }

  // Filter creatives to only those belonging to the current page or IG account.
  const pageIdPrefixes = new Set([pageId, effectivePagePrefix].filter(Boolean) as string[])
  const matchesPage = (storyId: string | undefined) =>
    typeof storyId === 'string' && Array.from(pageIdPrefixes).some(p => storyId.startsWith(`${p}_`))

  const matchesIg = (storyId: string | undefined) => {
    if (typeof storyId !== 'string') return false
    if (igUserId && storyId.startsWith(`${igUserId}_`)) return true
    const postId = storyId.includes('_') ? storyId.split('_').slice(1).join('_') : storyId
    return igMediaIdSet.has(postId)
  }

  const adCreatives = pageIdPrefixes.size > 0 || igUserId || igMediaIdSet.size > 0
    ? allAdCreatives.filter(c => {
        const sid = c.effective_object_story_id as string | undefined
        const igId = adIdToIgStoryId.get(c.ad_id as string)
        if (!sid && !igId) return false
        return matchesPage(sid) || matchesIg(sid) || (igId ? matchesIg(igId) : false)
      })
    : allAdCreatives

  // Look up post message from Firestore fbPosts for each creative with a storyId.
  // Searches under both pageId and storyIdPrefix paths since page IDs may differ.
  const storyIds = Array.from(new Set(adCreatives.map(c => c.effective_object_story_id as string).filter(Boolean)))
  const postMessageMap: Record<string, string> = {}
  if (storyIds.length > 0) {
    const searchPaths = Array.from(new Set([pageId, effectivePagePrefix].filter(Boolean) as string[]))
    await Promise.all(storyIds.map(async sid => {
      // 1. Try Firestore fbPosts (fast, no API call)
      for (const pid of searchPaths) {
        try {
          const doc = await userRef.collection('pages').doc(pid).collection('fbPosts').doc(sid).get()
          if (doc.exists) {
            const msg = (doc.data() as { message?: string }).message
            if (msg) { postMessageMap[sid] = msg; return }
          }
        } catch { /* ignore */ }
      }
      // Legacy path
      try {
        const doc = await userRef.collection('fbPosts').doc(sid).get()
        if (doc.exists) {
          const msg = (doc.data() as { message?: string }).message
          if (msg) { postMessageMap[sid] = msg; return }
        }
      } catch { /* ignore */ }
      // 2. Fallback: Meta Graph API
      try {
        const postUrl = new URL(`${BASE}/${sid}`)
        postUrl.searchParams.set('fields', 'message,story')
        postUrl.searchParams.set('access_token', userAccessToken)
        const res = await fetch(postUrl)
        if (res.ok) {
          const data = await res.json()
          if (data.message || data.story) postMessageMap[sid] = data.message ?? data.story
        }
      } catch { /* ignore */ }
    }))
  }
  const adCreativesWithTitle = adCreatives.map(c => {
    const sid = c.effective_object_story_id as string | undefined
    return sid && postMessageMap[sid] ? { ...c, post_title: postMessageMap[sid] } : c
  })

  // Load known IG media IDs from Firestore to catch cross-account and cross-format ads.
  // (Moved to the top before filtering adCreatives)

  // Build adPostIds + adPostMetrics (FB) and igPostIds + igPostMetrics (IG) from 90d data
  const adPostIds: string[] = []
  const adPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number }> = {}
  const igPostIds: string[] = []
  const igPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number }> = {}
  for (const c of adLevelAllTime) {
    const storyId = adIdToStoryId.get(c.ad_id as string)
    if (!storyId) continue
    const igStoryId = adIdToIgStoryId.get(c.ad_id as string)
    const postId = storyId.includes('_') ? storyId.split('_').slice(1).join('_') : storyId
    const isCurrentIgPost = !!igUserId && storyId.startsWith(`${igUserId}_`)
    const treatAsIg = isCurrentIgPost || igMediaIdSet.has(postId) || (igStoryId ? igMediaIdSet.has(igStoryId) : false)
    const finalIgPostId = igStoryId && igMediaIdSet.has(igStoryId) ? igStoryId : postId
    const isFb = pageIdPrefixes.size > 0 && matchesPage(storyId)
    if (!treatAsIg && !isFb) continue
    const cSpend = parseFloat(c.spend as string ?? '0')
    const cActions: MetaAction[] = (c.actions as MetaAction[]) ?? []
    const cActionValues: MetaAction[] = (c.action_values as MetaAction[]) ?? []
    const cPurchases = parseActions(cActions, 'purchase')
    const cLinkClicks = parseActions(cActions, 'link_click')
    const cVideoViews = parseActions(cActions, 'video_view')
    const cRevenue = parseActions(cActionValues, 'purchase')
    const cPrimaryMetric = cPurchases > 0 ? cRevenue : cLinkClicks > 0 ? cLinkClicks : cVideoViews
    const cRoas = cSpend > 0 && cPrimaryMetric > 0
      ? (cPurchases > 0 ? cPrimaryMetric / cSpend : cPrimaryMetric / cSpend * 100)
      : 0
    const cCpa = cPrimaryMetric > 0 ? cSpend / cPrimaryMetric : 0
    const cCtr = parseFloat(c.ctr as string ?? '0')
    const metricsVal = { spend: cSpend, roas: parseFloat(cRoas.toFixed(2)), cpa: parseFloat(cCpa.toFixed(2)), ctr: cCtr }
    if (treatAsIg) {
      if (!igPostIds.includes(finalIgPostId)) igPostIds.push(finalIgPostId)
      const existing = igPostMetrics[finalIgPostId]
      if (!existing || cSpend > existing.spend) igPostMetrics[finalIgPostId] = metricsVal
    }
    if (isFb) {
      if (!adPostIds.includes(postId)) adPostIds.push(postId)
      const existing = adPostMetrics[postId]
      if (!existing || cSpend > existing.spend) adPostMetrics[postId] = metricsVal
    }
  }

  // Supplement adPostMetrics / igPostMetrics from adCreatives
  for (const c of adCreatives) {
    const storyId = (c.effective_object_story_id as string | undefined)
      ?? adIdToStoryId.get(c.ad_id as string)
    if (!storyId) continue
    const igStoryId = adIdToIgStoryId.get(c.ad_id as string)
    const postIdKey = storyId.includes('_') ? storyId.split('_').slice(1).join('_') : storyId
    const isCurrentIgPost = !!igUserId && storyId.startsWith(`${igUserId}_`)
    const treatAsIg = isCurrentIgPost || igMediaIdSet.has(postIdKey) || (igStoryId ? igMediaIdSet.has(igStoryId) : false)
    const finalIgPostIdKey = igStoryId && igMediaIdSet.has(igStoryId) ? igStoryId : postIdKey
    const isFb = pageIdPrefixes.size > 0 && matchesPage(storyId)
    if (!treatAsIg && !isFb) continue
    if (treatAsIg ? igPostMetrics[finalIgPostIdKey] : adPostMetrics[postIdKey]) continue
    const cSpend = parseFloat(c.spend as string ?? '0')
    const cActions: MetaAction[] = (c.actions as MetaAction[]) ?? []
    const cActionValues: MetaAction[] = (c.action_values as MetaAction[]) ?? []
    const cPurchases = parseActions(cActions, 'purchase')
    const cLinkClicks = parseActions(cActions, 'link_click')
    const cVideoViews = parseActions(cActions, 'video_view')
    const cRevenue = parseActions(cActionValues, 'purchase')
    const cPrimaryMetric = cPurchases > 0 ? cRevenue : cLinkClicks > 0 ? cLinkClicks : cVideoViews
    const cRoas = cSpend > 0 && cPrimaryMetric > 0
      ? (cPurchases > 0 ? cPrimaryMetric / cSpend : cPrimaryMetric / cSpend * 100)
      : 0
    const cCpa = cPrimaryMetric > 0 ? cSpend / cPrimaryMetric : 0
    const cCtr = parseFloat(c.ctr as string ?? '0')
    const metricsVal = { spend: cSpend, roas: parseFloat(cRoas.toFixed(2)), cpa: parseFloat(cCpa.toFixed(2)), ctr: cCtr }
    if (treatAsIg) {
      if (!igPostIds.includes(finalIgPostIdKey)) igPostIds.push(finalIgPostIdKey)
      const existing = igPostMetrics[finalIgPostIdKey]
      if (!existing || cSpend > existing.spend) igPostMetrics[finalIgPostIdKey] = metricsVal
    }
    if (isFb) {
      if (!adPostIds.includes(postIdKey)) adPostIds.push(postIdKey)
      const existing = adPostMetrics[postIdKey]
      if (!existing || cSpend > existing.spend) adPostMetrics[postIdKey] = metricsVal
    }
  }

  const insightsRef = pageId
    ? userRef.collection('pages').doc(pageId).collection('adInsights').doc('latest')
    : userRef.collection('adInsights').doc('latest')

  await insightsRef.set({
    syncedAt: Timestamp.now(),
    dateRange: { from: since ?? dateFrom, to: until ?? dateTo },
    adAccountId,
    conversionType,
    summary: { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa },
    daily,
    adCreatives: adCreativesWithTitle,
    adPostIds,
    adPostMetrics,
    igPostIds,
    igPostMetrics,
  })

  // If this sync found creatives, write them to the shared page-level path so other
  // page admins (who may not have access to this ad account) can read them.
  if (pageId && adCreativesWithTitle.length > 0) {
    await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').set({
      syncedAt: Timestamp.now(),
      adCreatives: adCreativesWithTitle,
      adPostIds,
      adPostMetrics,
      igPostIds,
      igPostMetrics,
    }, { merge: true })
  }

  return NextResponse.json({
    success: true, adAccountId, spend, conversions, conversionType,
    adCreativesCount: adCreativesWithTitle.length,
    _debug: {
      adsListCount: adsList.length,
      adsListSample: adsList.slice(0, 5).map(ad => ({ id: ad.id, sid: ad.effective_object_story_id, creative: ad.creative })),
      allTimeCount: adLevelAllTime.length,
      allAdCreativesCount: allAdCreatives.length,
      pageId: pageId ?? null,
      effectivePagePrefix: effectivePagePrefix ?? null,
      sampleStoryIds: allAdCreatives.slice(0, 5).map(c => c.effective_object_story_id ?? null),
      postTitlesFound: Object.keys(postMessageMap).length,
      adPostMetricsCount: Object.keys(adPostMetrics).length,
      adPostMetricsSample: Object.entries(adPostMetrics).slice(0, 3).map(([k, v]) => ({ key: k, ...v })),
      igPostMetricsCount: Object.keys(igPostMetrics).length,
      igPostMetricsSample: Object.entries(igPostMetrics).slice(0, 3).map(([k, v]) => ({ key: k, ...v })),
      igMediaIdSetSize: igMediaIdSet.size,
      igUserId: igUserId ?? null,
      allTimeErrors,
    },
  })
  } catch (err) {
    console.error('ads sync error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
