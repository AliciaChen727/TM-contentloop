// Threads real publishing (Agent 自動發布 S4a). Two-step per post: create a
// container → publish. Long text auto-splits into a reply chain (主貼 + 留言…).
// Video containers process async → poll status until FINISHED before publishing.
// Requires threads_content_publish scope. Threads API: graph.threads.net/v1.0.

import { GRAPH } from './client'
import { splitForThreads } from '@/lib/publish/threadsSplit'
import type { MediaType } from '@/lib/content/draftTypes'

const API = `${GRAPH}/v1.0`

type ThreadsMediaType = 'TEXT' | 'IMAGE' | 'VIDEO'
function toThreadsMediaType(m: MediaType, hasMedia: boolean): ThreadsMediaType {
  if (!hasMedia) return 'TEXT'
  if (m === 'video' || m === 'reels') return 'VIDEO'
  if (m === 'image' || m === 'carousel' || m === 'story') return 'IMAGE'
  return 'TEXT'
}

async function post(path: string, params: Record<string, string>): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) return { error: j.error?.message ?? `threads ${res.status}` }
  return { id: j.id ? String(j.id) : undefined }
}

// Poll container status before publishing. All container types (TEXT/IMAGE/VIDEO/CAROUSEL)
// need this — even text containers require brief propagation time and will return
// "resource does not exist" if published immediately. TEXT containers return FINISHED
// instantly; VIDEO/CAROUSEL may take seconds to minutes.
async function waitReady(token: string, creationId: string, isText = false): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 20; i++) {                       // ~20 × 3s ≈ 60s budget
    const res = await fetch(`${API}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    
    if (!j.error) {
      const status = j.status as string | undefined
      if (status === 'FINISHED') return { ok: true }
      if (status === 'ERROR' || status === 'EXPIRED') return { ok: false, error: j.error_message ?? `container ${status}` }
      // TEXT containers may not return a status field at all, but if j.error is absent, it exists and is ready.
      if (isText && status === undefined) return { ok: true }
    }
    
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ok: false, error: 'media processing timed out' }
}

async function createAndPublish(
  token: string, params: Record<string, string>, isVideo: boolean,
): Promise<{ id?: string; error?: string }> {
  const created = await post('me/threads', { ...params, access_token: token })
  if (created.error || !created.id) return { error: created.error ?? 'no creation id' }
  // Always poll ready — TEXT containers need propagation time too (root cause of
  // "The requested resource does not exist" errors on immediate publish).
  const ready = await waitReady(token, created.id, !isVideo)
  if (!ready.ok) return { error: ready.error }
  return post('me/threads_publish', { creation_id: created.id, access_token: token })
}

export interface ThreadsPublishInput {
  text: string
  mediaUrl?: string
  mediaUrls?: string[]   // carousel (2–10 items); each item may be image or video
  mediaType: MediaType
  topicTag?: string      // Threads topic_tag (single, no # needed)
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)

// Build a CAROUSEL container: one child container per item → the carousel parent.
// Returns the carousel creation id (unpublished) or an error.
async function createCarouselContainer(
  token: string, urls: string[], text: string, topicTag?: string,
): Promise<{ id?: string; error?: string }> {
  // Build all child containers IN PARALLEL — video children each poll up to ~60s,
  // so sequential (N × 60s) blows past the serverless limit. Parallel ≈ one poll.
  const results = await Promise.all(urls.map(async (url): Promise<{ id?: string; error?: string }> => {
    const isVid = isVideoUrl(url)
    const child = await post('me/threads', {
      access_token: token, is_carousel_item: 'true',
      media_type: isVid ? 'VIDEO' : 'IMAGE', ...(isVid ? { video_url: url } : { image_url: url }),
    })
    if (child.error || !child.id) return { error: child.error ?? 'carousel child failed' }
    if (isVid) { const ready = await waitReady(token, child.id); if (!ready.ok) return { error: ready.error } }
    return { id: child.id }
  }))
  const failed = results.find(r => r.error)
  if (failed) return { error: failed.error }
  const children = results.map(r => r.id!)   // Promise.all preserves order
  return post('me/threads', {
    access_token: token, media_type: 'CAROUSEL', children: children.join(','), text,
    ...(topicTag?.trim() ? { topic_tag: topicTag.trim() } : {}),
  })
}

async function fetchPermalink(token: string, mediaId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    return j.permalink ? String(j.permalink) : undefined
  } catch { return undefined }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Wait until a just-published post is fetchable (= replyable). Video/carousel
// posts finish processing async and reject replies with "resource does not
// exist" until then. ~30 × 3s ≈ 90s budget. Best-effort (proceeds either way).
async function waitPostReplyable(token: string, postId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/${postId}?fields=id&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    if (j.id) return
    await sleep(3000)
  }
}

// Publishes the (possibly multi-segment) post. On partial success (root live but
// a reply failed) still returns rootId so the caller records it — never re-post
// the root. `ok:false` with a rootId means "main post is live, replies partial".
export async function publishThreads(
  token: string, input: ThreadsPublishInput,
): Promise<{ ok: true; rootId: string; permalink?: string; ids: string[] } | { ok: false; error: string }> {
  const carouselUrls = (input.mediaUrls ?? []).filter(Boolean)
  const isCarousel = input.mediaType === 'carousel' && carouselUrls.length >= 2
  const hasMedia = !!input.mediaUrl
  const tmt = toThreadsMediaType(input.mediaType, hasMedia)
  const isVideo = tmt === 'VIDEO'
  const segments = splitForThreads(input.text)
  const parts = segments.length ? segments : ['']

  // Root post: a CAROUSEL (2–10 items) or a single TEXT/IMAGE/VIDEO container.
  let rootId: string
  if (isCarousel) {
    const carousel = await createCarouselContainer(token, carouselUrls, parts[0], input.topicTag)
    if (carousel.error || !carousel.id) return { ok: false, error: carousel.error ?? 'carousel build failed' }
    // The carousel PARENT also finalizes async (esp. with video children) — publishing
    // before it's FINISHED yields "resource does not exist". Poll it first.
    const ready = await waitReady(token, carousel.id)
    if (!ready.ok) return { ok: false, error: ready.error ?? 'carousel not ready' }
    const pub = await post('me/threads_publish', { creation_id: carousel.id, access_token: token })
    if (pub.error || !pub.id) return { ok: false, error: pub.error ?? 'carousel publish failed' }
    rootId = pub.id
  } else {
    const rootParams: Record<string, string> = { media_type: tmt, text: parts[0] }
    if (input.topicTag?.trim()) rootParams.topic_tag = input.topicTag.trim()
    if (hasMedia && tmt === 'IMAGE') rootParams.image_url = input.mediaUrl!
    if (hasMedia && tmt === 'VIDEO') rootParams.video_url = input.mediaUrl!
    const root = await createAndPublish(token, rootParams, isVideo)
    if (root.error || !root.id) return { ok: false, error: root.error ?? 'publish failed' }
    rootId = root.id
  }

  const ids = [rootId]
  // A freshly-published post (esp. video/carousel) is NOT immediately replyable —
  // GET/reply_to_id yields "resource does not exist" until it finishes processing.
  // Root cause of prior reply failures: 23s wasn't enough. Poll until the post is
  // fetchable (≈ up to 90s) BEFORE starting the reply chain.
  if (parts.length > 1) await waitPostReplyable(token, rootId)
  // Remaining segments → text replies chained to the previous post.
  let prev = rootId
  for (let i = 1; i < parts.length; i++) {
    let reply: { id?: string; error?: string } = { error: 'init' }
    for (let attempt = 0; attempt < 4 && (reply.error || !reply.id); attempt++) {
      await sleep(2000 + attempt * 2000)
      reply = await createAndPublish(token, { media_type: 'TEXT', text: parts[i], reply_to_id: prev }, false)
    }
    if (reply.error || !reply.id) {
      // Partial: main post is live but a reply failed. Report it — the draft
      // stays re-publishable (user deletes on Threads then re-publishes).
      return { ok: false, error: `主貼已發布，但留言串第 ${i} 則失敗：${reply.error ?? 'unknown'}（可到 Threads 刪除後從草稿重發）` }
    }
    ids.push(reply.id)
    prev = reply.id
  }
  const permalink = await fetchPermalink(token, rootId)
  return { ok: true, rootId, permalink, ids }
}
