export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

const BASE = 'https://graph.facebook.com/v21.0'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const decoded = await adminAuth.verifyIdToken(idToken)
  const uid = decoded.uid

  // Prefer page-scoped token (multi-page) when ?pageId= is given; fall back to legacy 'page'.
  const pageIdParam = req.nextUrl.searchParams.get('pageId')
  const tokenSnap = await adminDb
    .collection('users').doc(uid)
    .collection('metaTokens').doc(pageIdParam || 'page').get()

  const { pageId, accessToken, igUserId, userAccessToken } = tokenSnap.data() as {
    pageId: string; accessToken: string; igUserId: string; userAccessToken?: string
  }

  // 取第一篇 FB 貼文 —— 一律以 pageId 為界，避免同時管理多個粉專時跨頁混合。
  // 先讀 page-scoped path；若還在 legacy collection，用 `${pageId}_` 前綴過濾。
  let firstFbPostId: string | undefined
  {
    const scopedSnap = await adminDb
      .collection('users').doc(uid).collection('pages').doc(pageId).collection('fbPosts')
      .orderBy('createdTime', 'desc').limit(1).get()
    if (!scopedSnap.empty) {
      firstFbPostId = scopedSnap.docs[0].id
    } else {
      const legacySnap = await adminDb
        .collection('users').doc(uid).collection('fbPosts')
        .orderBy('createdTime', 'desc').limit(50).get()
      firstFbPostId = legacySnap.docs.find(d => d.id.startsWith(`${pageId}_`))?.id
    }
  }

  // 取第一篇 IG 貼文 —— IG legacy 無 page 前綴，已知 pageId 時只讀 page-scoped path。
  const igPostsSnap = await adminDb
    .collection('users').doc(uid).collection('pages').doc(pageId).collection('igPosts')
    .orderBy('timestamp', 'desc').limit(1).get()
  const firstIgMediaId = igPostsSnap.docs[0]?.id

  const results: Record<string, unknown> = { pageId, igUserId, firstFbPostId, firstIgMediaId }

  // ── Follower-stats probe: which metric/field actually returns data? ──
  {
    const followerProbe: Record<string, unknown> = {}
    const nodeUrl = new URL(`${BASE}/${pageId}`)
    nodeUrl.searchParams.set('fields', 'followers_count,fan_count')
    nodeUrl.searchParams.set('access_token', accessToken)
    followerProbe.nodeFields = await (await fetch(nodeUrl)).json()

    const until = Math.floor(Date.now() / 1000)
    const since = until - 30 * 86400
    for (const metric of ['page_follows', 'page_fans', 'page_daily_follows_unique', 'page_fan_adds', 'page_fan_removes']) {
      const u = new URL(`${BASE}/${pageId}/insights`)
      u.searchParams.set('metric', metric)
      u.searchParams.set('period', 'day')
      u.searchParams.set('since', String(since))
      u.searchParams.set('until', String(until))
      u.searchParams.set('access_token', accessToken)
      followerProbe[metric] = await (await fetch(u)).json()
    }
    results.followerProbe = followerProbe
  }

  // ── Budget probe: raw campaign/adset budgets + run dates for the first few ads ──
  // Ads live under the ad account, reachable via the USER token (not the page token).
  try {
    const adsToken = userAccessToken ?? accessToken
    const acctUrl = new URL(`${BASE}/me/adaccounts`)
    acctUrl.searchParams.set('fields', 'id,name,currency')
    acctUrl.searchParams.set('access_token', adsToken)
    const acctData = await (await fetch(acctUrl)).json()
    const acctId = acctData.data?.[0]?.id
    results.budgetProbeCurrency = acctData.data?.[0]?.currency
    if (acctId) {
      const adsUrl = new URL(`${BASE}/${acctId}/ads`)
      adsUrl.searchParams.set('fields', 'id,name,campaign{name,daily_budget,lifetime_budget,start_time,stop_time},adset{name,daily_budget,lifetime_budget,start_time,end_time}')
      adsUrl.searchParams.set('limit', '5')
      adsUrl.searchParams.set('access_token', adsToken)
      results.budgetProbe = await (await fetch(adsUrl)).json()
    }
  } catch (e) {
    results.budgetProbeError = e instanceof Error ? e.message : 'budget probe failed'
  }

  // 測試 syncFbInsights 實際使用的 API call（/{pageId}/posts with reactions/comments/shares）
  {
    const url = new URL(`${BASE}/${pageId}/posts`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('fields', 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares')
    url.searchParams.set('limit', '3')
    const res = await fetch(url)
    results.fbPagePostsRaw = await res.json()
  }

  // 測試 FB Post Insights（舊方式，供對照）
  if (firstFbPostId) {
    const url = new URL(`${BASE}/${firstFbPostId}/insights`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('metric', 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks')
    const res = await fetch(url)
    results.fbInsightsRaw = await res.json()
  }

  // 測試 IG Media Insights
  if (firstIgMediaId) {
    const url = new URL(`${BASE}/${firstIgMediaId}/insights`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('metric', 'impressions,reach,saved')
    url.searchParams.set('period', 'lifetime')
    const res = await fetch(url)
    results.igInsightsRaw = await res.json()
  }

  // 測試 IG Media 基本資料（likes/comments 從這裡取）
  if (firstIgMediaId) {
    const url = new URL(`${BASE}/${firstIgMediaId}`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('fields', 'id,like_count,comments_count,media_type')
    const res = await fetch(url)
    results.igMediaRaw = await res.json()
  }

  // Token scope 診斷
  const appToken = `${process.env.NEXT_PUBLIC_META_APP_ID}|${process.env.META_APP_SECRET}`
  const debugUrl = new URL('https://graph.facebook.com/debug_token')
  debugUrl.searchParams.set('input_token', accessToken)
  debugUrl.searchParams.set('access_token', appToken)
  const debugRes = await fetch(debugUrl)
  results.tokenDebug = await debugRes.json()

  return NextResponse.json(results, { status: 200 })
}
