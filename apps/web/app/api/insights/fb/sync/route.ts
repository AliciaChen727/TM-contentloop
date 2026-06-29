export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { fetchPageFollowerStats } from '@/lib/meta/fetchPageFollowerStats'

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
    // NOTE: do NOT add `insights.metric(...)` as a field expansion here — Meta rejects it
    // with (#100) "must be a valid insights metric" and that error fails the ENTIRE /posts
    // query (taking reactions/comments/shares down with it → whole sync 500s). reactions/
    // comments/shares are plain fields and reliable; reach (insights) is handled by cron.
    const fullFields = 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares'
    const basicFields = 'id,message,story,created_time,permalink_url'

    type FbPostRow = { id: string; message?: string; story?: string; created_time: string; permalink_url?: string; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } }; shares?: { count: number } }
    type FetchResult = { ok: boolean; error?: { code?: number; message?: string }; posts: FbPostRow[] }
    let posts: FbPostRow[] = []
    let engagementAvailable = true

    // Paginate through ALL the page's posts (follow paging.next), not just the latest
    // page. Older posts that were zeroed by the pre-fix cron live beyond the first page,
    // so a single limit=50 fetch never refreshed them. Capped to avoid runaway/timeout.
    const MAX_PAGES = 10
    const PAGE_LIMIT = 100
    const fetchAllPosts = async (fields: string): Promise<FetchResult> => {
      const first = new URL(`${BASE}/${pageId}/posts`)
      first.searchParams.set('access_token', accessToken!)
      first.searchParams.set('fields', fields)
      first.searchParams.set('limit', String(PAGE_LIMIT))
      const out: FbPostRow[] = []
      let next: string | null = first.toString()
      let page = 0
      while (next && page < MAX_PAGES) {
        const r: Response = await fetch(next)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await r.json()
        if (!r.ok || d.error) {
          // First page error → surface it (lets #10 fallback kick in). Later-page error →
          // keep what we already paginated rather than discarding the whole run.
          if (out.length === 0) return { ok: false, error: d.error, posts: [] }
          break
        }
        out.push(...((d.data ?? []) as FbPostRow[]))
        next = (d.paging?.next as string | undefined) ?? null
        page++
      }
      return { ok: true, posts: out }
    }

    const full = await fetchAllPosts(fullFields)
    if (full.ok) {
      posts = full.posts
    } else if (full.error?.code === 10 || full.error?.message?.includes('pages_read_engagement')) {
      // Fallback: paginate basic fields only (engagement metrics unavailable)
      const basic = await fetchAllPosts(basicFields)
      if (!basic.ok) return NextResponse.json({ error: basic.error?.message ?? 'FB posts fetch failed' }, { status: 500 })
      posts = basic.posts
      engagementAvailable = false
    } else {
      return NextResponse.json({ error: full.error?.message ?? 'FB posts fetch failed' }, { status: 500 })
    }

    const fbPostsCol = adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('fbPosts')
    const now = Timestamp.now()

    // Read existing docs first so we never lose previously-synced engagement to an
    // intermittent empty API response. FB's reactions/comments fields are flaky —
    // taking max(existing, new) per metric keeps the real number and prevents the
    // "engagement flickers in and out" bug.
    const writable = posts.filter(p => p.message || p.story)
    const existingById = new Map<string, FirebaseFirestore.DocumentData>()
    // getAll / batched writes both have size limits — chunk so paginated runs (up to
    // ~1000 posts) don't exceed them (Firestore batch max = 500 ops).
    const READ_CHUNK = 300
    for (let i = 0; i < writable.length; i += READ_CHUNK) {
      const slice = writable.slice(i, i + READ_CHUNK)
      const snaps = await adminDb.getAll(...slice.map(p => fbPostsCol.doc(p.id)))
      for (const snap of snaps) if (snap.exists) existingById.set(snap.id, snap.data()!)
    }

    let batch = adminDb.batch()
    let ops = 0
    for (const post of writable) {
      const prev = existingById.get(post.id)?.insights ?? {}
      const r = post.reactions?.summary?.total_count
      const c = post.comments?.summary?.total_count
      const s = post.shares?.count
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record: Record<string, any> = {
        postId: post.id,
        message: post.message ?? post.story ?? '',
        createdTime: Timestamp.fromDate(new Date(post.created_time)),
        permalink: post.permalink_url ?? '',
        snapshotAt: now,
        engagementAvailable,
        insights: {
          reactions: Math.max(prev.reactions ?? 0, r ?? 0),
          comments: Math.max(prev.comments ?? 0, c ?? 0),
          shares: Math.max(prev.shares ?? 0, s ?? 0),
          reach: prev.reach ?? 0, // preserve reach written by cron; not fetched here
        },
      }
      batch.set(fbPostsCol.doc(post.id), record, { merge: true })
      ops++
      if (ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0 }
    }
    if (ops > 0) await batch.commit()

    // Page-level follower stats (daily time series). Non-fatal — never block post sync.
    let followerDays = 0
    try {
      const stats = await fetchPageFollowerStats(pageId, accessToken)
      if (stats.length > 0) {
        const statsCol = adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('pageStats')
        const statsBatch = adminDb.batch()
        for (const s of stats) {
          statsBatch.set(statsCol.doc(s.date), { ...s, snapshotAt: now }, { merge: true })
        }
        await statsBatch.commit()
        followerDays = stats.length
      }
    } catch { /* follower stats are best-effort */ }

    return NextResponse.json({ success: true, synced: posts.length, followerDays })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'FB sync failed' }, { status: 500 })
  }
}
