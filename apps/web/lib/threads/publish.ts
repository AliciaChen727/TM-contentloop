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

// Video containers report status async; wait until FINISHED (or fail) before publish.
async function waitReady(token: string, creationId: string): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 20; i++) {                       // ~20 × 3s ≈ 60s budget
    const res = await fetch(`${API}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    const status = j.status as string | undefined
    if (status === 'FINISHED') return { ok: true }
    if (status === 'ERROR' || status === 'EXPIRED') return { ok: false, error: j.error_message ?? `container ${status}` }
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ok: false, error: 'media processing timed out' }
}

async function createAndPublish(
  token: string, params: Record<string, string>, isVideo: boolean,
): Promise<{ id?: string; error?: string }> {
  const created = await post('me/threads', { ...params, access_token: token })
  if (created.error || !created.id) return { error: created.error ?? 'no creation id' }
  if (isVideo) {
    const ready = await waitReady(token, created.id)
    if (!ready.ok) return { error: ready.error }
  }
  return post('me/threads_publish', { creation_id: created.id, access_token: token })
}

export interface ThreadsPublishInput {
  text: string
  mediaUrl?: string
  mediaType: MediaType
  topicTag?: string      // Threads topic_tag (single, no # needed)
}

async function fetchPermalink(token: string, mediaId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    return j.permalink ? String(j.permalink) : undefined
  } catch { return undefined }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Publishes the (possibly multi-segment) post. On partial success (root live but
// a reply failed) still returns rootId so the caller records it — never re-post
// the root. `ok:false` with a rootId means "main post is live, replies partial".
export async function publishThreads(
  token: string, input: ThreadsPublishInput,
): Promise<{ ok: true; rootId: string; permalink?: string; ids: string[] } | { ok: false; error: string }> {
  const hasMedia = !!input.mediaUrl
  const tmt = toThreadsMediaType(input.mediaType, hasMedia)
  const isVideo = tmt === 'VIDEO'
  const segments = splitForThreads(input.text)
  const parts = segments.length ? segments : ['']

  // Root post — carries the media (if any) + optional topic tag.
  const rootParams: Record<string, string> = { media_type: tmt, text: parts[0] }
  if (input.topicTag?.trim()) rootParams.topic_tag = input.topicTag.trim()
  if (hasMedia && tmt === 'IMAGE') rootParams.image_url = input.mediaUrl!
  if (hasMedia && tmt === 'VIDEO') rootParams.video_url = input.mediaUrl!
  const root = await createAndPublish(token, rootParams, isVideo)
  if (root.error || !root.id) return { ok: false, error: root.error ?? 'publish failed' }

  const rootId = root.id
  const ids = [rootId]
  // Remaining segments → text replies chained to the previous post. The just-
  // published post needs a moment to be replyable; small delay + one retry.
  let prev = rootId
  for (let i = 1; i < parts.length; i++) {
    await sleep(1500)
    let reply = await createAndPublish(token, { media_type: 'TEXT', text: parts[i], reply_to_id: prev }, false)
    if (reply.error || !reply.id) { await sleep(2500); reply = await createAndPublish(token, { media_type: 'TEXT', text: parts[i], reply_to_id: prev }, false) }
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
