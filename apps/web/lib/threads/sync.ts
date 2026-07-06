// Core Threads sync (shared by /api/threads/sync and the daily cron). Reads the
// stored Threads token for a page, fetches posts + insights, stores at
// pages/{pageId}/threadsInsights/latest. Content only (no ads).

import { adminDb } from '@/lib/firebase/admin'
import { GRAPH, getThreadsToken } from '@/lib/threads/client'

const POST_METRICS = 'views,likes,replies,reposts,quotes,shares'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metricMap(data: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of (data?.data ?? [])) {
    out[m.name] = Number(m?.total_value?.value ?? m?.values?.[0]?.value ?? 0) || 0
  }
  return out
}

export async function syncThreadsForPage(
  tokenOwnerUid: string, pageId: string,
): Promise<{ ok: boolean; postCount?: number; error?: string }> {
  const tok = await getThreadsToken(tokenOwnerUid, pageId)
  if (!tok) return { ok: false, error: 'not_connected' }
  const t = tok.accessToken

  const postsRes = await fetch(`${GRAPH}/v1.0/me/threads?fields=id,media_type,media_url,permalink,text,timestamp&limit=25&access_token=${encodeURIComponent(t)}`)
  const postsData = await postsRes.json()
  if (!postsRes.ok || postsData.error) return { ok: false, error: postsData.error?.message ?? `posts ${postsRes.status}` }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPosts: any[] = postsData.data ?? []

  const posts = await Promise.all(rawPosts.slice(0, 25).map(async p => {
    let metrics: Record<string, number> = {}
    try {
      const insRes = await fetch(`${GRAPH}/v1.0/${p.id}/insights?metric=${POST_METRICS}&access_token=${encodeURIComponent(t)}`)
      const ins = await insRes.json()
      if (insRes.ok && !ins.error) metrics = metricMap(ins)
    } catch { /* skip */ }
    return {
      id: p.id, mediaType: p.media_type ?? null, text: (p.text ?? '').slice(0, 200),
      permalink: p.permalink ?? null, timestamp: p.timestamp ?? null, metrics,
    }
  }))

  // Followers: `followers_count` is a total_value account metric. It must be
  // fetched ALONE (mixing it with time-series metrics like views needs since/until
  // and 400s the whole call) and via `me/` — the stored threadsUserId can be stale.
  let followersCount: number | null = null
  try {
    const accRes = await fetch(`${GRAPH}/v1.0/me/threads_insights?metric=followers_count&access_token=${encodeURIComponent(t)}`)
    const acc = await accRes.json()
    if (accRes.ok && !acc.error) {
      const v = acc?.data?.[0]?.total_value?.value
      if (typeof v === 'number') followersCount = v
    }
  } catch { /* optional */ }

  await adminDb.collection('pages').doc(pageId).collection('threadsInsights').doc('latest').set({
    threadsUserId: tok.threadsUserId, posts, followersCount, postCount: posts.length,
    syncedAt: new Date().toISOString(),
  }, { merge: true })

  // Threads gives no follower HISTORY, so we snapshot today's count daily to build
  // a trend going forward (pages/{pageId}/threadsStats/{YYYY-MM-DD}).
  if (followersCount !== null) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    await adminDb.collection('pages').doc(pageId).collection('threadsStats').doc(today)
      .set({ date: today, followers: followersCount, snapshotAt: new Date().toISOString() }, { merge: true })
  }

  return { ok: true, postCount: posts.length }
}
