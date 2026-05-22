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

  const { pageId, accessToken, igUserId } = tokenSnap.data() as {
    pageId: string; accessToken: string; igUserId: string
  }

  // 取第一篇 FB 貼文
  const fbPostsSnap = await adminDb
    .collection('users').doc(uid).collection('fbPosts')
    .orderBy('createdTime', 'desc').limit(1).get()
  const firstFbPostId = fbPostsSnap.docs[0]?.id

  // 取第一篇 IG 貼文
  const igPostsSnap = await adminDb
    .collection('users').doc(uid).collection('igPosts')
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
