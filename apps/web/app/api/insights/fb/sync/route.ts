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

    const { accessToken } = tokenDoc.data() as { accessToken?: string }
    if (!accessToken) return NextResponse.json({ error: 'No page access token' }, { status: 400 })

    // Fetch recent posts with engagement metrics
    const fullFields = 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares'
    const basicFields = 'id,message,story,created_time,permalink_url'

    let posts: { id: string; message?: string; story?: string; created_time: string; permalink_url?: string; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } }; shares?: { count: number } }[] = []
    let engagementAvailable = true

    const fetchUrl = new URL(`${BASE}/${pageId}/posts`)
    fetchUrl.searchParams.set('access_token', accessToken)
    fetchUrl.searchParams.set('fields', fullFields)
    fetchUrl.searchParams.set('limit', '50')

    const res = await fetch(fetchUrl)
    const data = await res.json()

    if (!res.ok || data.error) {
      // Fallback: try without engagement metrics
      if (data.error?.code === 10 || data.error?.message?.includes('pages_read_engagement')) {
        const basicUrl = new URL(`${BASE}/${pageId}/posts`)
        basicUrl.searchParams.set('access_token', accessToken)
        basicUrl.searchParams.set('fields', basicFields)
        basicUrl.searchParams.set('limit', '50')
        const basicRes = await fetch(basicUrl)
        const basicData = await basicRes.json()
        if (!basicRes.ok || basicData.error) {
          return NextResponse.json({ error: basicData.error?.message ?? 'FB posts fetch failed' }, { status: 500 })
        }
        posts = basicData.data ?? []
        engagementAvailable = false
      } else {
        return NextResponse.json({ error: data.error?.message ?? 'FB posts fetch failed' }, { status: 500 })
      }
    } else {
      posts = data.data ?? []
    }

    const fbPostsCol = adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('fbPosts')
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const post of posts) {
      if (!post.message && !post.story) continue
      batch.set(fbPostsCol.doc(post.id), {
        postId: post.id,
        message: post.message ?? post.story ?? '',
        createdTime: Timestamp.fromDate(new Date(post.created_time)),
        permalink: post.permalink_url ?? '',
        snapshotAt: now,
        engagementAvailable,
        insights: {
          reactions: post.reactions?.summary?.total_count ?? 0,
          comments: post.comments?.summary?.total_count ?? 0,
          shares: post.shares?.count ?? 0,
        },
      }, { merge: true })
    }

    await batch.commit()
    return NextResponse.json({ success: true, synced: posts.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'FB sync failed' }, { status: 500 })
  }
}
