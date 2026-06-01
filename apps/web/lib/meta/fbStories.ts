import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { persistStoryThumbnail } from '@/lib/meta/igStories'

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

async function fetchFbStoryData(postId: string, token: string): Promise<{ reach: number; views: number; createdTime: string | null; thumbUrl: string }> {
  const result = { reach: 0, views: 0, createdTime: null as string | null, thumbUrl: '' }

  // created_time for the date axis + the media image so we can show a screenshot
  // (like IG). full_picture gives a thumbnail for both photo and video stories;
  // attachments.media.image.src is the fallback.
  try {
    const u = new URL(`${BASE}/${postId}`)
    u.searchParams.set('fields', 'created_time,full_picture,attachments{media{image{src}}}')
    u.searchParams.set('access_token', token)
    const r = await fetch(u)
    const d = await r.json()
    if (r.ok) {
      if (d.created_time) result.createdTime = d.created_time
      result.thumbUrl = d.full_picture
        ?? d.attachments?.data?.[0]?.media?.image?.src
        ?? ''
    }
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
    if (!res.ok || data.error) {
      console.error(`[fbStories] pageId=${pageId} status=${res.status} error=${JSON.stringify(data.error).slice(0, 300)}`)
      return { synced: 0, error: data.error?.message ?? 'fb stories fetch failed' }
    }
    stories = data.data ?? []
    // The Page Stories edge returns 200 + empty for manually-posted stories
    // (Meta limitation), so only log when something actually came back.
    if (stories.length > 0) {
      console.log(`[fbStories] pageId=${pageId} count=${stories.length} sample=${JSON.stringify(stories[0] ?? {}).slice(0, 250)}`)
    }
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : 'fb stories fetch exception' }
  }
  if (!stories.length) return { synced: 0 }

  const withData = await Promise.all(stories.map(async story => {
    const postId = story.post_id || story.id || ''
    const d = postId ? await fetchFbStoryData(postId, pageToken) : { reach: 0, views: 0, createdTime: null, thumbUrl: '' }
    return { story, postId, d }
  }))

  // page-scoped path only (cross-page isolation rule)
  const col = adminDb
    .collection('users').doc(uid)
    .collection('pages').doc(pageId)
    .collection('fbStories')

  // Reuse any previously-persisted thumbnail so it isn't lost when the Meta CDN
  // URL expires (FB story media URLs churn the same way IG's do).
  const ids = withData.map(({ postId }) => postId).filter(Boolean)
  const existingThumb = new Map<string, string>()
  if (ids.length) {
    const snaps = await adminDb.getAll(...ids.map(id => col.doc(id)))
    for (const snap of snaps) {
      const t = snap.data()?.thumbnailMedia
      if (snap.exists && typeof t === 'string' && t) existingThumb.set(snap.id, t)
    }
  }

  const batch = adminDb.batch()
  let count = 0
  for (const { story, postId, d } of withData) {
    if (!postId) continue
    // Persist once to Storage (permanent). Reuse the existing copy on later syncs.
    const persisted = existingThumb.get(postId)
      ?? (await persistStoryThumbnail(uid, pageId, postId, d.thumbUrl))
      ?? ''
    batch.set(col.doc(postId), {
      id: postId,
      platform: 'FB',
      mediaType: 'STORY',
      mediaSubType: (story.media_type ?? '').toUpperCase().includes('VIDEO') ? 'VIDEO' : 'IMAGE',
      thumbnailUrl: persisted || d.thumbUrl,        // prefer permanent Storage URL
      thumbnailMedia: persisted || existingThumb.get(postId) || '', // permanent copy
      thumbnailLive: d.thumbUrl,                     // raw Meta CDN URL (may expire)
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
