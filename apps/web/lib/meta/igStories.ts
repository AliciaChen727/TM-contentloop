import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const BASE = 'https://graph.facebook.com/v21.0'

// IG Stories disappear from the API 24h after they go live, so we can only ever
// capture what is currently live. Run this often (cron + on manual sync).
export interface StoryInsights {
  reach: number
  views: number
  replies: number
  tapForward: number
  tapBack: number
  tapExit: number
  swipeForward: number
}

interface RawStory {
  id: string
  media_type?: 'IMAGE' | 'VIDEO'
  permalink?: string
  thumbnail_url?: string
  media_url?: string
  timestamp: string
  caption?: string
}

// Story insight metrics have churned a lot across API versions (impressions →
// views, taps_* → navigation breakdown). Request the whole set, but tolerate a
// total failure of any single call so one bad metric never zeroes everything.
async function fetchStoryInsights(storyId: string, token: string): Promise<StoryInsights> {
  const result: StoryInsights = {
    reach: 0, views: 0, replies: 0, tapForward: 0, tapBack: 0, tapExit: 0, swipeForward: 0,
  }

  const tryMetrics = async (metrics: string) => {
    const u = new URL(`${BASE}/${storyId}/insights`)
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

  // Graceful degradation: v21 uses `impressions`; newer versions use `views`.
  let core = await tryMetrics('reach,impressions,replies')
  if (!core) core = await tryMetrics('reach,views,replies')
  if (!core) core = await tryMetrics('reach,replies')
  for (const m of core ?? []) {
    const v = m.values?.[0]?.value ?? 0
    if (m.name === 'reach') result.reach = v
    else if (m.name === 'impressions' || m.name === 'views') result.views = v
    else if (m.name === 'replies') result.replies = v
  }

  // Navigation breakdown → skip-rate proxy (tap forward / exit / swipe forward).
  const navU = new URL(`${BASE}/${storyId}/insights`)
  navU.searchParams.set('metric', 'navigation')
  navU.searchParams.set('breakdown', 'story_navigation_action_type')
  navU.searchParams.set('metric_type', 'total_value')
  navU.searchParams.set('period', 'lifetime')
  navU.searchParams.set('access_token', token)
  try {
    const r = await fetch(navU)
    const d = await r.json()
    if (r.ok && !d.error) {
      const results = d.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []
      for (const res of results as { dimension_values?: string[]; value?: number }[]) {
        const key = res.dimension_values?.[0]
        const val = res.value ?? 0
        if (key === 'tap_forward') result.tapForward = val
        else if (key === 'tap_back') result.tapBack = val
        else if (key === 'tap_exit') result.tapExit = val
        else if (key === 'swipe_forward') result.swipeForward = val
      }
    }
  } catch { /* navigation is best-effort; skip-rate just shows — without it */ }

  return result
}

// Fetch all currently-live IG stories for a page and persist them to the
// page-scoped collection. Returns count synced (0 when no live stories).
export async function syncIgStories(
  uid: string,
  accessToken: string,
  igUserId: string,
  pageId: string,
): Promise<{ synced: number; error?: string }> {
  const url = new URL(`${BASE}/${igUserId}/stories`)
  url.searchParams.set('fields', 'id,media_type,permalink,thumbnail_url,media_url,timestamp,caption')
  url.searchParams.set('access_token', accessToken)

  let stories: RawStory[]
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok || data.error) return { synced: 0, error: data.error?.message ?? 'stories fetch failed' }
    stories = data.data ?? []
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : 'stories fetch exception' }
  }
  if (!stories.length) return { synced: 0 }

  const withInsights = await Promise.all(
    stories.map(async story => ({ story, ins: await fetchStoryInsights(story.id, accessToken) })),
  )

  // page-scoped path only — never legacy collection (cross-page isolation rule)
  const col = adminDb
    .collection('users').doc(uid)
    .collection('pages').doc(pageId)
    .collection('igStories')
  const batch = adminDb.batch()
  for (const { story, ins } of withInsights) {
    batch.set(col.doc(story.id), {
      id: story.id,
      mediaType: 'STORY',
      mediaSubType: story.media_type ?? 'IMAGE', // IMAGE | VIDEO
      thumbnailUrl: story.thumbnail_url ?? story.media_url ?? '',
      permalink: story.permalink ?? '',
      timestamp: Timestamp.fromDate(new Date(story.timestamp)),
      caption: story.caption ?? '',
      insights: ins,
      syncedAt: Timestamp.now(),
    }, { merge: true })
  }
  await batch.commit()
  return { synced: stories.length }
}
