// Instagram publishing (Agent 自動發布 S4b). Needs instagram_content_publish +
// an IG Business/Creator account linked to the FB Page. Two-step: create media
// container → publish. Video/Reels + carousel parents process async → poll
// status_code=FINISHED before publish (learned from Threads). Graph API v21.0.

import type { MediaType } from '@/lib/content/draftTypes'

const BASE = 'https://graph.facebook.com/v21.0'
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)

// 從 Storage URL 取出可辨識的檔名（signed URL 很長，錯誤訊息只需要尾巴那段）。
export function mediaName(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    return path.split('/').filter(Boolean).pop() ?? url.slice(-40)
  } catch {
    return url.slice(-40)
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Meta 錯誤物件（只列我們會讀的欄位）。 */
export interface MetaErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    fbtrace_id?: string
  }
}

// Meta 的 `message` 常常只有一個沒有資訊量的字（實例：IG 輪播回 "Fatal"，code -1），
// 真正可行動的說明在 error_user_msg / error_user_title，追查則要 code + fbtrace_id。
// 只存 message 等於把這些全丟掉 —— 2026-08-17 那次 IG 發布失敗就查不出原因。
// 匯出為純函式以便測試。
export function formatMetaError(body: MetaErrorBody, httpStatus?: number): string {
  const e = body?.error
  if (!e) return `ig ${httpStatus ?? 'request failed'}`

  // 順序＝可讀性由高到低；三者都保留（原始 message 絕不丟，它才是對照 Meta 文件的鍵），
  // 但相同字串只留一次。
  const parts: string[] = []
  for (const s of [e.error_user_title, e.error_user_msg, e.message]) {
    const t = s?.trim()
    if (t && !parts.includes(t)) parts.push(t)
  }
  if (!parts.length) parts.push(`ig ${httpStatus ?? 'error'}`)

  const codes: string[] = []
  if (typeof e.code === 'number') codes.push(`code ${e.code}`)
  if (typeof e.error_subcode === 'number') codes.push(`subcode ${e.error_subcode}`)
  if (e.type) codes.push(e.type)
  if (e.fbtrace_id) codes.push(`trace ${e.fbtrace_id}`)
  if (codes.length) parts.push(`(${codes.join(', ')})`)

  return parts.join(' — ')
}

async function post(path: string, params: Record<string, string>): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) return { error: formatMetaError(j, res.status) }
  return { id: j.id ? String(j.id) : undefined }
}

// IG media containers finalize async; wait until FINISHED before publishing.
// 一併取 `status`：container 失敗時 IG 把原因寫在這個欄位，只看 status_code 只拿得到 "ERROR"。
async function waitReady(token: string, creationId: string): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 30; i++) {                        // ~30 × 3s ≈ 90s budget
    const res = await fetch(`${BASE}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`)
    const j = await res.json().catch(() => ({}))
    if (j.error) return { ok: false, error: formatMetaError(j, res.status) }
    const s = j.status_code as string | undefined
    if (s === 'FINISHED') return { ok: true }
    if (s === 'ERROR' || s === 'EXPIRED') {
      const detail = typeof j.status === 'string' && j.status.trim() ? ` — ${j.status.trim()}` : ''
      return { ok: false, error: `container ${s}${detail}` }
    }
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
  // Always poll — publishing an unready STORIES container fails (root cause of
  // earlier story failures where the image itself was fine).
  const c = await createContainer(igUserId, token, { media_type: 'STORIES', ...(vid ? { video_url: mediaUrl } : { image_url: mediaUrl }) }, true)
  if (c.error || !c.id) return { ok: false, error: c.error ?? 'story container failed' }
  const pub = await post(`${igUserId}/media_publish`, { creation_id: c.id, access_token: token })
  if (pub.error || !pub.id) return { ok: false, error: pub.error ?? 'story publish failed' }
  return { ok: true, postId: pub.id }
}

export interface IgPublishInput { text: string; mediaType: MediaType; mediaUrl?: string; mediaUrls?: string[]; locationId?: string }

// IG requires media (no text-only posts). Returns published media id + permalink.
export async function publishToInstagram(
  igUserId: string, token: string, input: IgPublishInput,
): Promise<{ ok: true; postId: string; permalink?: string } | { ok: false; error: string }> {
  const { text, mediaType, mediaUrl } = input
  const withLocation = (params: Record<string, string>): Record<string, string> =>
    input.locationId ? { ...params, location_id: input.locationId } : params
  const urls = (input.mediaUrls ?? []).filter(Boolean)
  const isCarousel = mediaType === 'carousel' && urls.length >= 2

  let containerId: string | undefined
  if (isCarousel) {
    // Children in parallel (video children each poll ~90s → parallel ≈ one poll).
    const children = await Promise.all(urls.map(async (u): Promise<{ id?: string; error?: string }> => {
      const vid = isVideoUrl(u)
      return createContainer(igUserId, token, { is_carousel_item: 'true', ...(vid ? { media_type: 'VIDEO', video_url: u } : { image_url: u }) }, vid)
    }))
    // 10 張平行建 container，錯誤要指出是「第幾張」+ 檔名，否則無從重現。
    const badIdx = children.findIndex(c => c.error || !c.id)
    if (badIdx >= 0) {
      const reason = children[badIdx].error ?? 'carousel child failed'
      return { ok: false, error: `輪播第 ${badIdx + 1}/${urls.length} 張失敗（${mediaName(urls[badIdx])}）：${reason}` }
    }
    const c = await createContainer(igUserId, token, withLocation({ media_type: 'CAROUSEL', children: children.map(x => x.id!).join(','), caption: text }), true)
    if (c.error || !c.id) return { ok: false, error: c.error ?? 'carousel container failed' }
    containerId = c.id
  } else if (!mediaUrl) {
    return { ok: false, error: 'Instagram 需要圖片或影片（不支援純文字）' }
  } else if (mediaType === 'video' || mediaType === 'reels' || isVideoUrl(mediaUrl)) {
    const c = await createContainer(igUserId, token, withLocation({ media_type: 'REELS', video_url: mediaUrl, caption: text }), true)
    if (c.error || !c.id) return { ok: false, error: c.error ?? 'video container failed' }
    containerId = c.id
  } else {
    // Poll even for images — publishing an unready container can fail.
    const c = await createContainer(igUserId, token, withLocation({ image_url: mediaUrl, caption: text }), true)
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
