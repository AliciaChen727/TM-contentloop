import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const BASE = 'https://graph.facebook.com/v21.0'

// FB Page Stories. Unlike IG, with "Stories Archive" enabled the /stories edge
// also returns expired stories, so this isn't strictly 24h-bound. Insights for
// FB stories are limited (often only impressions/reach), so we degrade
// gracefully and store whatever comes back — missing metrics show as 0.

interface RawFbStory {
  post_id?: string
  id?: string
  media_type?: string
  url?: string
  status?: string
}

async function fetchFbStoryData(postId: string, token: string): Promise<{ reach: number; views: number; createdTime: string | null }> {
  const result = { reach: 0, views: 0, createdTime: null as string | null }

  // created_time for the dashboard date axis
  try {
    const u = new URL(`${BASE}/${postId}`)
    u.searchParams.set('fields', 'created_time')
    u.searchParams.set('access_token', token)
    const r = await fetch(u)
    const d = await r.json()
    if (r.ok && d.created_time) result.createdTime = d.created_time
  } catch { /* best-effort */ }

  // insights — graceful degradation (FB story metrics are sparse / churning)
  const tryMetrics = async (metrics: string) => {
    const u = new URL(`${BASE}/${postId}/insights`)
    u.searchParams.set('metric', metrics)
    u.searchParams.set('period', 'lifetime')
    u.searchParams.set('access_token', token)
    try {
      const r = await fetch(u)
      const d = await r.json()
      if (!r.ok || d.error) return null
      return (d.data ?? []) as { name: string; values?: { value: number }[] }[]
    } catch {
      return null
    }
  }
  let ins = await tryMetrics('post_impressions_unique,post_impressions')
  if (!ins) ins = await tryMetrics('post_impressions_unique')
  for (const m of ins ?? []) {
    const v = m.values?.[0]?.value ?? 0
    if (m.name === 'post_impressions_unique') result.reach = v
    else if (m.name === 'post_impressions') result.views = v
  }
  return result
}

export async function syncFbStories(
  uid: string,
  pageToken: string,
  pageId: string,
): Promise<{ synced: number; error?: string }> {
  const url = new URL(`${BASE}/${pageId}/stories`)
  url.searchParams.set('access_token', pageToken)

  let stories: RawFbStory[]
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok || data.error) return { synced: 0, error: data.error?.message ?? 'fb stories fetch failed' }
    stories = data.data ?? []
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : 'fb stories fetch exception' }
  }
  if (!stories.length) return { synced: 0 }

  const withData = await Promise.all(stories.map(async story => {
    const postId = story.post_id || story.id || ''
    const d = postId ? await fetchFbStoryData(postId, pageToken) : { reach: 0, views: 0, createdTime: null }
    return { story, postId, d }
  }))

  // page-scoped path only (cross-page isolation rule)
  const col = adminDb
    .collection('users').doc(uid)
    .collection('pages').doc(pageId)
    .collection('fbStories')
  const batch = adminDb.batch()
  let count = 0
  for (const { story, postId, d } of withData) {
    if (!postId) continue
    batch.set(col.doc(postId), {
      id: postId,
      platform: 'FB',
      mediaType: 'STORY',
      mediaSubType: (story.media_type ?? '').toUpperCase().includes('VIDEO') ? 'VIDEO' : 'IMAGE',
      permalink: story.url ?? '',
      timestamp: d.createdTime ? Timestamp.fromDate(new Date(d.createdTime)) : Timestamp.now(),
      insights: { reach: d.reach, views: d.views, replies: 0, tapForward: 0, tapBack: 0, tapExit: 0, swipeForward: 0 },
      syncedAt: Timestamp.now(),
    }, { merge: true })
    count++
  }
  await batch.commit()
  return { synced: count }
}
