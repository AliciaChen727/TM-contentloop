export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const BASE = 'https://graph.facebook.com/v19.0'

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
    if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

    const tokenDoc = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
    if (!tokenDoc.exists) return NextResponse.json({ error: 'No Meta token for this page' }, { status: 400 })

    const tokenData = tokenDoc.data() as { accessToken?: string; igUserId?: string }
    const { accessToken } = tokenData
    let igUserId = tokenData.igUserId
    if (!accessToken) return NextResponse.json({ error: 'No page access token' }, { status: 400 })

    // Self-heal: if igUserId is missing (token was connected before IG permission was granted),
    // fetch it from Meta API and persist so future syncs skip this step.
    if (!igUserId) {
      const pageRes = await fetch(`${BASE}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`)
      const pageData = await pageRes.json()
      const fetchedIgId: string | undefined = pageData.instagram_business_account?.id
      if (!fetchedIgId) return NextResponse.json({ error: 'No IG account linked to this page' }, { status: 400 })
      await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).update({ igUserId: fetchedIgId })
      igUserId = fetchedIgId
    }

    // Verify which IG account we're querying (helps diagnose wrong igUserId)
    const verifyUrl = new URL(`${BASE}/${igUserId}`)
    verifyUrl.searchParams.set('fields', 'username,media_count')
    verifyUrl.searchParams.set('access_token', accessToken)
    const verifyRes = await fetch(verifyUrl)
    const verifyData = await verifyRes.json()
    const igUsername: string = verifyData.username ?? 'unknown'

    const mediaUrl = new URL(`${BASE}/${igUserId}/media`)
    mediaUrl.searchParams.set('fields', 'id,timestamp,caption,media_type,media_product_type,permalink,like_count,comments_count')
    mediaUrl.searchParams.set('limit', '50')
    mediaUrl.searchParams.set('access_token', accessToken)

    const mediaRes = await fetch(mediaUrl)
    const mediaData = await mediaRes.json()
    if (!mediaRes.ok || mediaData.error) {
      return NextResponse.json({ error: mediaData.error?.message ?? 'IG media fetch failed' }, { status: 500 })
    }

    type IgPost = { id: string; timestamp: string; caption?: string; media_type: string; media_product_type?: string; permalink: string; like_count: number; comments_count: number }
    const posts: IgPost[] = mediaData.data ?? []

    const withInsights = await Promise.all(posts.map(async post => {
      const isReel = post.media_product_type === 'REELS'
      const isFeedVideo = post.media_type === 'VIDEO' && !isReel
      const metrics = isFeedVideo ? 'reach,saved,shares,video_views' : 'reach,saved,shares'
      const insUrl = new URL(`${BASE}/${post.id}/insights`)
      insUrl.searchParams.set('metric', metrics)
      insUrl.searchParams.set('period', 'lifetime')
      insUrl.searchParams.set('access_token', accessToken)
      try {
        const insRes = await fetch(insUrl)
        const insData = await insRes.json()
        const vals: Record<string, number> = {}
        for (const m of (insData.data ?? []) as { name: string; values: { value: number }[] }[]) {
          vals[m.name] = m.values?.[0]?.value ?? 0
        }
        return { ...post, _ins: vals }
      } catch {
        return { ...post, _ins: {} as Record<string, number> }
      }
    }))

    const igPostsCol = adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('igPosts')
    const batch = adminDb.batch()
    for (const post of withInsights) {
      const ins = post._ins
      batch.set(igPostsCol.doc(post.id), {
        id: post.id,
        caption: post.caption ?? '',
        mediaType: post.media_product_type === 'REELS' ? 'REELS' : post.media_type,
        permalink: post.permalink,
        timestamp: Timestamp.fromDate(new Date(post.timestamp)),
        insights: {
          likes: post.like_count ?? 0,
          comments: post.comments_count ?? 0,
          reach: ins.reach ?? 0,
          saved: ins.saved ?? 0,
          shares: ins.shares ?? 0,
          views: ins.video_views ?? ins.plays ?? 0,
        },
        syncedAt: Timestamp.now(),
      }, { merge: true })
    }
    await batch.commit()

    return NextResponse.json({ success: true, synced: posts.length, igUserId, igUsername, mediaCount: verifyData.media_count ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'IG sync failed' }, { status: 500 })
  }
}
