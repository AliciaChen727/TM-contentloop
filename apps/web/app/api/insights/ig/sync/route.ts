export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { syncIgStories } from '@/lib/meta/igStories'

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

    // Always verify the currently-linked IG account from Meta API.
    // This ensures we pick up new connections when the user re-links IG via Meta Business.
    const pageRes = await fetch(`${BASE}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`)
    const pageData = await pageRes.json()
    const fetchedIgId: string | undefined = pageData.instagram_business_account?.id
    if (!fetchedIgId) return NextResponse.json({ error: 'No IG account linked to this page' }, { status: 400 })
    if (fetchedIgId !== igUserId) {
      await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).update({ igUserId: fetchedIgId })
    }
    igUserId = fetchedIgId

    // Verify which IG account we're querying (helps diagnose wrong igUserId)
    const verifyUrl = new URL(`${BASE}/${igUserId}`)
    verifyUrl.searchParams.set('fields', 'username,media_count')
    verifyUrl.searchParams.set('access_token', accessToken)
    const verifyRes = await fetch(verifyUrl)
    const verifyData = await verifyRes.json()
    const igUsername: string = verifyData.username ?? 'unknown'

    type IgPost = { id: string; timestamp: string; caption?: string; media_type: string; media_product_type?: string; permalink: string; like_count: number; comments_count: number }

    // Paginate through ALL media (follow paging.next), not just the latest 50.
    const MAX_PAGES = 10
    const PAGE_LIMIT = 100
    const mediaFields = 'id,timestamp,caption,media_type,media_product_type,permalink,like_count,comments_count'
    const posts: IgPost[] = []
    {
      const first = new URL(`${BASE}/${igUserId}/media`)
      first.searchParams.set('fields', mediaFields)
      first.searchParams.set('limit', String(PAGE_LIMIT))
      first.searchParams.set('access_token', accessToken)
      let next: string | null = first.toString()
      let page = 0
      while (next && page < MAX_PAGES) {
        const r: Response = await fetch(next)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await r.json()
        if (!r.ok || d.error) {
          // First page error → surface; later-page error → keep what we paginated.
          if (posts.length === 0) return NextResponse.json({ error: d.error?.message ?? 'IG media fetch failed' }, { status: 500 })
          break
        }
        posts.push(...((d.data ?? []) as IgPost[]))
        next = (d.paging?.next as string | undefined) ?? null
        page++
      }
    }

    // Per-post insights in bounded chunks (avoid hundreds of concurrent calls / rate limits).
    const INS_CHUNK = 25
    const withInsights: (IgPost & { _ins: Record<string, number> })[] = []
    for (let i = 0; i < posts.length; i += INS_CHUNK) {
      const slice = posts.slice(i, i + INS_CHUNK)
      const done = await Promise.all(slice.map(async post => {
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
      withInsights.push(...done)
    }

    const igPostsCol = adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('igPosts')
    // read-then-max for insights-derived metrics so a failed per-post /insights call
    // (catch → {}) can't wipe real reach/saved/shares/views. likes/comments come from the
    // media fields (authoritative current count) → set directly. Chunk getAll + batch to
    // stay under Firestore limits (batch max = 500 ops) once pagination returns many posts.
    const existingById = new Map<string, FirebaseFirestore.DocumentData>()
    const READ_CHUNK = 300
    for (let i = 0; i < withInsights.length; i += READ_CHUNK) {
      const slice = withInsights.slice(i, i + READ_CHUNK)
      const snaps = await adminDb.getAll(...slice.map(p => igPostsCol.doc(p.id)))
      for (const snap of snaps) if (snap.exists) existingById.set(snap.id, snap.data()!)
    }

    let batch = adminDb.batch()
    let ops = 0
    for (const post of withInsights) {
      const ins = post._ins
      const prev = (existingById.get(post.id)?.insights ?? {}) as Record<string, number>
      batch.set(igPostsCol.doc(post.id), {
        id: post.id,
        caption: post.caption ?? '',
        mediaType: post.media_product_type === 'REELS' ? 'REELS' : post.media_type,
        permalink: post.permalink,
        timestamp: Timestamp.fromDate(new Date(post.timestamp)),
        insights: {
          likes: post.like_count ?? 0,
          comments: post.comments_count ?? 0,
          reach: Math.max(prev.reach ?? 0, ins.reach ?? 0),
          saved: Math.max(prev.saved ?? 0, ins.saved ?? 0),
          shares: Math.max(prev.shares ?? 0, ins.shares ?? 0),
          views: Math.max(prev.views ?? 0, ins.video_views ?? ins.plays ?? 0),
        },
        syncedAt: Timestamp.now(),
      }, { merge: true })
      ops++
      if (ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0 }
    }
    if (ops > 0) await batch.commit()

    // Also capture currently-live Stories (only available for 24h via the API)
    const storyResult = await syncIgStories(uid, accessToken, igUserId, pageId)

    return NextResponse.json({ success: true, synced: posts.length, stories: storyResult.synced, igUserId, igUsername, mediaCount: verifyData.media_count ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'IG sync failed' }, { status: 500 })
  }
}
