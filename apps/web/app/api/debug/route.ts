export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

const BASE = 'https://graph.facebook.com/v19.0'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const decoded = await adminAuth.verifyIdToken(idToken)
  const uid = decoded.uid

  const tokenSnap = await adminDb
    .collection('users').doc(uid)
    .collection('metaTokens').doc('page').get()

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

  // 測試 FB Post Insights
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

  return NextResponse.json(results, { status: 200 })
}
