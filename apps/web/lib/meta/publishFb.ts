// Facebook Page publishing (Agent 自動發布 S4b). Needs pages_manage_posts.
// Text → /feed; single image → /photos; single video → /videos; multi-photo →
// upload unpublished /photos then attach to /feed. Graph API v21.0.
// FB feed does not support mixed photo+video carousels — carousel = photos.

import type { MediaType } from '@/lib/content/draftTypes'

const BASE = 'https://graph.facebook.com/v21.0'
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)

async function post(path: string, params: Record<string, string>): Promise<{ id?: string; postId?: string; error?: string }> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) return { error: j.error?.message ?? `fb ${res.status}` }
  return { id: j.id ? String(j.id) : undefined, postId: j.post_id ? String(j.post_id) : undefined }
}

// Publish a FB Page photo Story (24h). Video stories need resumable upload —
// deferred; image stories are a simple 2-step (upload unpublished → photo_stories).
export async function publishFbStory(
  pageId: string, pageToken: string, mediaUrl: string,
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  if (isVideoUrl(mediaUrl)) return { ok: false, error: 'FB 影片限動尚未支援（需分段上傳），目前僅支援圖片限動' }
  const up = await post(`${pageId}/photos`, { url: mediaUrl, published: 'false', access_token: pageToken })
  if (up.error || !up.id) return { ok: false, error: up.error ?? 'story photo upload failed' }
  const r = await post(`${pageId}/photo_stories`, { photo_id: up.id, access_token: pageToken })
  const id = r.postId ?? r.id
  if (r.error || !id) return { ok: false, error: r.error ?? 'photo_stories failed' }
  return { ok: true, postId: id }
}

export interface FbPublishInput { text: string; mediaType: MediaType; mediaUrl?: string; mediaUrls?: string[] }

// Returns the published post id + a permalink.
export async function publishToFacebook(
  pageId: string, pageToken: string, input: FbPublishInput,
): Promise<{ ok: true; postId: string; permalink: string } | { ok: false; error: string }> {
  const { text, mediaType, mediaUrl } = input
  const urls = (input.mediaUrls ?? []).filter(Boolean)
  const isCarousel = mediaType === 'carousel' && urls.length >= 2

  let postId: string | undefined
  if (isCarousel) {
    // Upload each photo unpublished → attach to a single feed post. Videos in a
    // multi-media FB post aren't supported, so only photos are attached.
    const photos = urls.filter(u => !isVideoUrl(u))
    if (photos.length === 0) return { ok: false, error: 'FB 輪播目前僅支援多張相片' }
    const fbids = await Promise.all(photos.map(u => post(`${pageId}/photos`, { url: u, published: 'false', access_token: pageToken })))
    const bad = fbids.find(r => r.error || !r.id)
    if (bad) return { ok: false, error: bad.error ?? 'photo upload failed' }
    const attached = fbids.map(r => ({ media_fbid: r.id! }))
    const r = await post(`${pageId}/feed`, { message: text, attached_media: JSON.stringify(attached), access_token: pageToken })
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'feed post failed' }
    postId = r.id
  } else if (mediaType === 'text' || !mediaUrl) {
    const r = await post(`${pageId}/feed`, { message: text, access_token: pageToken })
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'feed post failed' }
    postId = r.id
  } else if (mediaType === 'video' || mediaType === 'reels' || isVideoUrl(mediaUrl)) {
    const r = await post(`${pageId}/videos`, { file_url: mediaUrl, description: text, access_token: pageToken })
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'video post failed' }
    postId = r.id
  } else {
    const r = await post(`${pageId}/photos`, { url: mediaUrl, caption: text, access_token: pageToken })
    postId = r.postId ?? r.id
    if (r.error || !postId) return { ok: false, error: r.error ?? 'photo post failed' }
  }

  return { ok: true, postId: postId!, permalink: `https://www.facebook.com/${postId}` }
}
