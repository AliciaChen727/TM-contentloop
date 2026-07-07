// Instagram publishing (Agent 自動發布 S4b). Needs instagram_content_publish +
// an IG Business/Creator account linked to the FB Page. Two-step: create media
// container → publish. Video/Reels + carousel parents process async → poll
// status_code=FINISHED before publish (learned from Threads). Graph API v21.0.

import type { MediaType } from '@/lib/content/draftTypes'

const BASE = 'https://graph.facebook.com/v21.0'
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function post(path: string, params: Record<string, string>): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) return { error: j.error?.message ?? `ig ${res.status}` }
  return { id: j.id ? String(j.id) : undefined }
}

// IG media containers finalize async; wait until FINISHED before publishing.
async function waitReady(token: string, creationId: string): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 30; i++) {                        // ~30 × 3s ≈ 90s budget
    const res = await fetch(`${BASE}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    const s = j.status_code as string | undefined
    if (s === 'FINISHED') return { ok: true }
    if (s === 'ERROR' || s === 'EXPIRED') return { ok: false, error: `container ${s}` }
    await sleep(3000)
  }
  return { ok: false, error: 'media processing timed out' }
}

async function createContainer(igUserId: string, token: string, params: Record<string, string>, needsPoll: boolean): Promise<{ id?: string; error?: string }> {
  const c = await post(`${igUserId}/media`, { ...params, access_token: token })
  if (c.error || !c.id) return { error: c.error ?? 'container failed' }
  if (needsPoll) { const r = await waitReady(token, c.id); if (!r.ok) return { error: r.error } }
  return { id: c.id }
}

// Publish a 24h IG Story (single image or video). Videos poll before publish.
export async function publishIgStory(
  igUserId: string, token: string, mediaUrl: string,
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  const vid = isVideoUrl(mediaUrl)
  const c = await createContainer(igUserId, token, { media_type: 'STORIES', ...(vid ? { video_url: mediaUrl } : { image_url: mediaUrl }) }, vid)
  if (c.error || !c.id) return { ok: false, error: c.error ?? 'story container failed' }
  const pub = await post(`${igUserId}/media_publish`, { creation_id: c.id, access_token: token })
  if (pub.error || !pub.id) return { ok: false, error: pub.error ?? 'story publish failed' }
  return { ok: true, postId: pub.id }
}

export interface IgPublishInput { text: string; mediaType: MediaType; mediaUrl?: string; mediaUrls?: string[] }

// IG requires media (no text-only posts). Returns published media id + permalink.
export async function publishToInstagram(
  igUserId: string, token: string, input: IgPublishInput,
): Promise<{ ok: true; postId: string; permalink?: string } | { ok: false; error: string }> {
  const { text, mediaType, mediaUrl } = input
  const urls = (input.mediaUrls ?? []).filter(Boolean)
  const isCarousel = mediaType === 'carousel' && urls.length >= 2

  let containerId: string | undefined
  if (isCarousel) {
    // Children in parallel (video children each poll ~90s → parallel ≈ one poll).
    const children = await Promise.all(urls.map(async (u): Promise<{ id?: string; error?: string }> => {
      const vid = isVideoUrl(u)
      return createContainer(igUserId, token, { is_carousel_item: 'true', ...(vid ? { media_type: 'VIDEO', video_url: u } : { image_url: u }) }, vid)
    }))
    const bad = children.find(c => c.error || !c.id)
    if (bad) return { ok: false, error: bad.error ?? 'carousel child failed' }
    const c = await createContainer(igUserId, token, { media_type: 'CAROUSEL', children: children.map(x => x.id!).join(','), caption: text }, true)
    if (c.error || !c.id) return { ok: false, error: c.error ?? 'carousel container failed' }
    containerId = c.id
  } else if (!mediaUrl) {
    return { ok: false, error: 'Instagram 需要圖片或影片（不支援純文字）' }
  } else if (mediaType === 'video' || mediaType === 'reels' || isVideoUrl(mediaUrl)) {
    const c = await createContainer(igUserId, token, { media_type: 'REELS', video_url: mediaUrl, caption: text }, true)
    if (c.error || !c.id) return { ok: false, error: c.error ?? 'video container failed' }
    containerId = c.id
  } else {
    // Poll even for images — publishing an unready container can fail.
    const c = await createContainer(igUserId, token, { image_url: mediaUrl, caption: text }, true)
    if (c.error || !c.id) return { ok: false, error: c.error ?? 'image container failed' }
    containerId = c.id
  }

  const pub = await post(`${igUserId}/media_publish`, { creation_id: containerId!, access_token: token })
  if (pub.error || !pub.id) return { ok: false, error: pub.error ?? 'publish failed' }

  // Best-effort permalink lookup.
  let permalink: string | undefined
  try {
    const r = await fetch(`${BASE}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)
    const j = await r.json().catch(() => ({}))
    permalink = j.permalink ? String(j.permalink) : undefined
  } catch { /* ignore */ }
  return { ok: true, postId: pub.id, permalink }
}
