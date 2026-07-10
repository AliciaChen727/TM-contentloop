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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Raw POST that returns the full JSON (post() only extracts id) — needed for the
// resumable flow's video_id/upload_url.
async function rawPost(url: string, params: Record<string, string>, headers?: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(params) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await res.json().catch(() => ({}))
  return { ok: res.ok && !j.error, j }
}

// Wait until a resumable video finished uploading/processing before finish.
async function waitFbVideoReady(pageToken: string, videoId: string): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 30; i++) {                        // ~30 × 3s ≈ 90s
    const r = await fetch(`${BASE}/${videoId}?fields=status&access_token=${encodeURIComponent(pageToken)}`)
    const j = await r.json().catch(() => ({}))
    const up = j.status?.uploading_phase?.status
    const proc = j.status?.processing_phase?.status
    if (up === 'error' || proc === 'error') return { ok: false, error: j.status?.uploading_phase?.error?.message ?? j.status?.processing_phase?.error?.message ?? 'video processing error' }
    if (up === 'complete') return { ok: true }
    await sleep(3000)
  }
  return { ok: false, error: 'video upload/processing timed out' }
}

// Resumable video publish (Reels / video Story) from a hosted file URL:
// start → upload (file_url header) → wait → finish. Graph API v21.0.
async function publishFbVideoResumable(
  pageId: string, pageToken: string, videoUrl: string, endpoint: 'video_reels' | 'video_stories', finishParams: Record<string, string>,
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  const start = await rawPost(`${BASE}/${pageId}/${endpoint}`, { upload_phase: 'start', access_token: pageToken })
  if (!start.ok || !start.j.video_id || !start.j.upload_url) return { ok: false, error: start.j.error?.message ?? `${endpoint} start failed` }
  const videoId = String(start.j.video_id)
  // Tell FB to fetch the video from our public URL (hosted upload).
  const up = await fetch(String(start.j.upload_url), { method: 'POST', headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl } })
  const upj = await up.json().catch(() => ({}))
  if (!up.ok || upj.error) return { ok: false, error: upj.error?.message ?? `${endpoint} upload failed` }
  const ready = await waitFbVideoReady(pageToken, videoId)
  if (!ready.ok) return { ok: false, error: ready.error ?? 'not ready' }
  const fin = await rawPost(`${BASE}/${pageId}/${endpoint}`, { upload_phase: 'finish', video_id: videoId, ...finishParams, access_token: pageToken })
  if (!fin.ok) return { ok: false, error: fin.j.error?.message ?? `${endpoint} finish failed` }
  return { ok: true, postId: String(fin.j.post_id ?? videoId) }
}

// FB Page Reel (9:16 video). Resumable upload from a hosted URL.
export async function publishFbReel(
  pageId: string, pageToken: string, videoUrl: string, description: string,
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  return publishFbVideoResumable(pageId, pageToken, videoUrl, 'video_reels', { video_state: 'PUBLISHED', description })
}

// FB Page Story (24h). Video → resumable video_stories; image → 2-step photo_stories.
export async function publishFbStory(
  pageId: string, pageToken: string, mediaUrl: string,
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  if (isVideoUrl(mediaUrl)) return publishFbVideoResumable(pageId, pageToken, mediaUrl, 'video_stories', {})
  const up = await post(`${pageId}/photos`, { url: mediaUrl, published: 'false', access_token: pageToken })
  if (up.error || !up.id) return { ok: false, error: up.error ?? 'story photo upload failed' }
  const r = await post(`${pageId}/photo_stories`, { photo_id: up.id, access_token: pageToken })
  const id = r.postId ?? r.id
  if (r.error || !id) return { ok: false, error: r.error ?? 'photo_stories failed' }
  return { ok: true, postId: id }
}

export interface FbPublishInput {
  text: string
  mediaType: MediaType
  mediaUrl?: string
  mediaUrls?: string[]
  /** Deprecated: FB Page text mentions are not reliable in this flow. */
  pageMentionIds?: string[]
  /** Deprecated: FB personal profile links/tags are not supported in this flow. */
  personTagIds?: string[]
  placeId?: string
}

function addFbTagParams(params: Record<string, string>, input: FbPublishInput): Record<string, string> {
  const next = { ...params }
  if (input.placeId) next.place = input.placeId
  return next
}

// Returns the published post id + a permalink.
export async function publishToFacebook(
  pageId: string, pageToken: string, input: FbPublishInput,
): Promise<{ ok: true; postId: string; permalink: string } | { ok: false; error: string }> {
  const { mediaType, mediaUrl } = input
  const text = input.text
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
    const r = await post(`${pageId}/feed`, addFbTagParams({ message: text, attached_media: JSON.stringify(attached), access_token: pageToken }, input))
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'feed post failed' }
    postId = r.id
  } else if (mediaType === 'text' || !mediaUrl) {
    const r = await post(`${pageId}/feed`, addFbTagParams({ message: text, access_token: pageToken }, input))
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'feed post failed' }
    postId = r.id
  } else if (mediaType === 'reels') {
    const r = await publishFbReel(pageId, pageToken, mediaUrl, text)
    if (!r.ok) return r
    postId = r.postId
  } else if (mediaType === 'video' || isVideoUrl(mediaUrl)) {
    const r = await post(`${pageId}/videos`, { file_url: mediaUrl, description: text, access_token: pageToken })
    if (r.error || !r.id) return { ok: false, error: r.error ?? 'video post failed' }
    postId = r.id
  } else {
    const r = await post(`${pageId}/photos`, addFbTagParams({ url: mediaUrl, caption: text, access_token: pageToken }, input))
    postId = r.postId ?? r.id
    if (r.error || !postId) return { ok: false, error: r.error ?? 'photo post failed' }
  }

  return { ok: true, postId: postId!, permalink: `https://www.facebook.com/${postId}` }
}
