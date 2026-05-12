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

  const { userAccessToken, storyIdPrefix } = tokenDoc.data() as { userAccessToken?: string; storyIdPrefix?: string }
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

  const adLevelUrl = new URL(`${BASE}/${adAccountId}/insights`)
  adLevelUrl.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,ctr,actions,action_values,effective_object_story_id')
  Object.entries(dateRange).forEach(([k, v]) => adLevelUrl.searchParams.set(k, v))
  adLevelUrl.searchParams.set('level', 'ad')
  adLevelUrl.searchParams.set('limit', '100')
  adLevelUrl.searchParams.set('access_token', userAccessToken)

  // Fetch all ads regardless of spend (for creative library)
  // Include creative fields as reliable storyId source when insights haven't populated yet
  const adsListUrl = new URL(`${BASE}/${adAccountId}/ads`)
  adsListUrl.searchParams.set('fields', 'id,name,effective_status,effective_object_story_id,creative{object_story_id,effective_object_story_id}')
  adsListUrl.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED"]')
  adsListUrl.searchParams.set('limit', '100')
  adsListUrl.searchParams.set('access_token', userAccessToken)

  // Fetch last_90d ad-level data in parallel — used as fallback for creative library
  // AND for adPostMetrics (independent of selected date range)
  const adLevelAllTimeUrl = new URL(`${BASE}/${adAccountId}/insights`)
  adLevelAllTimeUrl.searchParams.set('fields', 'ad_id,ad_name,effective_object_story_id,spend,impressions,ctr,actions,action_values')
  adLevelAllTimeUrl.searchParams.set('date_preset', 'last_90d')
  adLevelAllTimeUrl.searchParams.set('level', 'ad')
  adLevelAllTimeUrl.searchParams.set('limit', '200')
  adLevelAllTimeUrl.searchParams.set('access_token', userAccessToken)

  const [summaryRes, dailyRes, adLevelRes, adsListRes, adLevelAllTimeRes] = await Promise.all([fetch(summaryUrl), fetch(dailyUrl), fetch(adLevelUrl), fetch(adsListUrl), fetch(adLevelAllTimeUrl)])
  const [summaryData, dailyData, adLevelData, adsListData, adLevelAllTimeData] = await Promise.all([summaryRes.json(), dailyRes.json(), adLevelRes.json(), adsListRes.json(), adLevelAllTimeRes.json()])

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
  const adsList: { id: string; name: string; effective_status: string; effective_object_story_id?: string; creative?: { object_story_id?: string; effective_object_story_id?: string } }[] = adsListData.data ?? []
  const allAdCreatives: Record<string, unknown>[] = adsList.length > 0
    ? adsList.map(ad => {
        if (insightsByAdId.has(ad.id)) return insightsByAdId.get(ad.id)!
        if (allTimeByAdId.has(ad.id)) return allTimeByAdId.get(ad.id)!
        // Fallback: use storyId from ad-level fields or creative object (reliable even before insights propagate)
        const storyId = ad.effective_object_story_id
          ?? ad.creative?.effective_object_story_id
          ?? ad.creative?.object_story_id
        return { ad_id: ad.id, ad_name: ad.name, ...(storyId ? { effective_object_story_id: storyId } : {}), spend: '0', impressions: '0', ctr: '0', actions: [], action_values: [] }
      })
    : (adLevelData.data ?? [])

  // Filter creatives to only those belonging to the current page.
  // Accept both pageId and storyIdPrefix — pages migrated to New Page Experience may have
  // old posts (storyIdPrefix) and new posts (pageId) using different page IDs.
  const pageIdPrefixes = new Set([pageId, effectivePagePrefix].filter(Boolean) as string[])
  const matchesPage = (storyId: string | undefined) =>
    typeof storyId === 'string' && Array.from(pageIdPrefixes).some(p => storyId.startsWith(`${p}_`))

  const adCreatives = pageIdPrefixes.size > 0
    ? allAdCreatives.filter(c => matchesPage(c.effective_object_story_id as string | undefined))
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

  // Build adPostIds + adPostMetrics from 90d data, filtered by pageId
  const adPostIds: string[] = []
  const adPostMetrics: Record<string, { spend: number; roas: number; cpa: number; ctr: number }> = {}
  for (const c of adLevelAllTime) {
    const storyId = c.effective_object_story_id as string | undefined
    if (!storyId) continue
    if (pageIdPrefixes.size > 0 && !matchesPage(storyId)) continue
    const postId = storyId
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
    if (!adPostIds.includes(postId)) adPostIds.push(postId)
    // Keep highest-spend metrics if same post appears multiple times (different ad sets)
    const existing = adPostMetrics[postId]
    if (!existing || cSpend > existing.spend) {
      adPostMetrics[postId] = { spend: cSpend, roas: parseFloat(cRoas.toFixed(2)), cpa: parseFloat(cCpa.toFixed(2)), ctr: cCtr }
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
  })

  return NextResponse.json({
    success: true, adAccountId, spend, conversions, conversionType,
    adCreativesCount: adCreativesWithTitle.length,
    _debug: {
      adsListCount: adsList.length,
      allTimeCount: adLevelAllTime.length,
      allAdCreativesCount: allAdCreatives.length,
      pageId: pageId ?? null,
      effectivePagePrefix: effectivePagePrefix ?? null,
      sampleStoryIds: allAdCreatives.slice(0, 5).map(c => c.effective_object_story_id ?? null),
      postTitlesFound: Object.keys(postMessageMap).length,
    },
  })
  } catch (err) {
    console.error('ads sync error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
