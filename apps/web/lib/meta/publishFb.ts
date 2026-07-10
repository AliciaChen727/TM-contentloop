// Facebook Page publishing (Agent 自動發布 S4b). Needs pages_manage_posts.
// Text → /feed; single image → /photos; single video → /videos; multi-photo →
// upload unpublished /photos then attach to /feed. Graph API v21.0.
// FB feed does not support mixed photo+video carousels — carousel = photos.

import type { MediaType } from '@/lib/content/draftTypes'
import sharp from 'sharp'
import { createHash, randomUUID } from 'crypto'
import { getStorage } from 'firebase-admin/storage'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const BASE = 'https://graph.facebook.com/v21.0'
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)
const FB_STORY_WIDTH = 1080
const FB_STORY_HEIGHT = 1920

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

async function uploadPublicJpeg(path: string, data: Buffer): Promise<string> {
  return uploadPublicFile(path, data, 'image/jpeg')
}

async function uploadPublicMp4(path: string, data: Buffer): Promise<string> {
  return uploadPublicFile(path, data, 'video/mp4')
}

async function uploadPublicFile(path: string, data: Buffer, contentType: string): Promise<string> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'contentloop-dev.firebasestorage.app'
  const token = randomUUID()
  await getStorage().bucket(bucketName).file(path).save(data, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  })
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

async function prepareFbStoryImageBuffer(mediaUrl: string): Promise<Buffer> {
  const res = await fetch(mediaUrl)
  if (!res.ok) throw new Error(`FB Story image fetch failed (${res.status})`)
  const input = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) throw new Error('FB Story image metadata unavailable')

  // FB photo_stories accepts many images, but non-9:16 source photos have shown
  // black screens for public viewers. Publish a normalized 9:16 JPEG instead of
  // handing Page Stories the feed/carousel source directly.
  const background = await sharp(input)
    .resize(FB_STORY_WIDTH, FB_STORY_HEIGHT, { fit: 'cover' })
    .blur(36)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  const foreground = await sharp(input)
    .rotate()
    .resize(FB_STORY_WIDTH, FB_STORY_HEIGHT, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer()

  return sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

async function imageBufferToStoryVideo(input: Buffer): Promise<Buffer> {
  const ffmpegBin = ffmpegPath
  if (!ffmpegBin) throw new Error('ffmpeg-static binary unavailable')
  const dir = await mkdtemp(join(tmpdir(), 'contentloop-fb-story-'))
  const inputPath = join(dir, 'story.jpg')
  const outputPath = join(dir, 'story.mp4')
  try {
    await writeFile(inputPath, input)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, [
        '-y',
        '-loop', '1',
        '-framerate', '30',
        '-i', inputPath,
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', '6',
        '-r', '30',
        '-shortest',
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '4.0',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        '-movflags', '+faststart',
        outputPath,
      ])
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk).slice(-4000) })
      proc.on('error', reject)
      proc.on('close', (code: number | null) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`))
      })
    })
    return readFile(outputPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function prepareFbStoryVideo(pageId: string, mediaUrl: string): Promise<{ storyImageUrl: string; storyVideoUrl: string }> {
  const image = await prepareFbStoryImageBuffer(mediaUrl)
  const hash = createHash('sha1').update(mediaUrl).digest('hex').slice(0, 12)
  const ts = Date.now()
  const [storyImageUrl, video] = await Promise.all([
    uploadPublicJpeg(`generated/fb-stories/${pageId}/${ts}-${hash}.jpg`, image),
    imageBufferToStoryVideo(image),
  ])
  const storyVideoUrl = await uploadPublicMp4(`generated/fb-stories/${pageId}/${ts}-${hash}.mp4`, video)
  return { storyImageUrl, storyVideoUrl }
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

// FB Page Story (24h). Video → resumable video_stories. Images are converted
// into short 9:16 MP4 videos and also use video_stories; this avoids a Meta
// photo_stories rendering issue where public viewers can see a black screen.
export async function publishFbStory(
  pageId: string, pageToken: string, mediaUrl: string,
): Promise<{ ok: true; postId: string; storyImageUrl?: string; storyVideoUrl?: string } | { ok: false; error: string }> {
  if (isVideoUrl(mediaUrl)) return publishFbVideoResumable(pageId, pageToken, mediaUrl, 'video_stories', {})
  let storyMedia: { storyImageUrl: string; storyVideoUrl: string }
  try {
    storyMedia = await prepareFbStoryVideo(pageId, mediaUrl)
  } catch (e) {
    return { ok: false, error: `FB 限動圖片轉影片失敗：${e instanceof Error ? e.message : 'unknown error'}` }
  }
  const r = await publishFbVideoResumable(pageId, pageToken, storyMedia.storyVideoUrl, 'video_stories', {})
  if (!r.ok) return r
  return { ok: true, postId: r.postId, ...storyMedia }
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

// Meta can return a transient error (e.g. code 1 "Please reduce the amount of
// data…") even though the write actually succeeded — 2026-07-10 實測：photo post
// 已出現在粉專，但 API 回錯誤，導致記成失敗且拿不到 postId（重試會重複發文）。
// 所以宣告失敗前先回讀粉專最近貼文：文案開頭吻合 + 幾分鐘內 → 視為已發出。
async function findJustPublishedPost(pageId: string, pageToken: string, text: string): Promise<string | null> {
  const head = text.trim().slice(0, 40)
  if (!head) return null
  // 逾時型錯誤的貼文可能晚幾秒才出現在 feed → 等 3s / 8s 各查一次。
  for (const delay of [3000, 8000]) {
    await sleep(delay)
    try {
      const r = await fetch(`${BASE}/${pageId}/feed?fields=id,created_time,message&limit=5&access_token=${encodeURIComponent(pageToken)}`)
      const d = await r.json().catch(() => ({})) as { data?: { id?: string; created_time?: string; message?: string }[] }
      for (const p of d.data ?? []) {
        const ageMs = Date.now() - new Date(p.created_time ?? 0).getTime()
        if (p.id && ageMs >= 0 && ageMs < 10 * 60_000 && (p.message ?? '').trim().startsWith(head)) return p.id
      }
    } catch { /* verification is best-effort */ }
  }
  return null
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
    postId = r.id
    if (r.error || !postId) {
      postId = (await findJustPublishedPost(pageId, pageToken, text)) ?? undefined
      if (!postId) return { ok: false, error: r.error ?? 'feed post failed' }
    }
  } else if (mediaType === 'text' || !mediaUrl) {
    const r = await post(`${pageId}/feed`, addFbTagParams({ message: text, access_token: pageToken }, input))
    postId = r.id
    if (r.error || !postId) {
      postId = (await findJustPublishedPost(pageId, pageToken, text)) ?? undefined
      if (!postId) return { ok: false, error: r.error ?? 'feed post failed' }
    }
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
    if (r.error || !postId) {
      postId = (await findJustPublishedPost(pageId, pageToken, text)) ?? undefined
      if (!postId) return { ok: false, error: r.error ?? 'photo post failed' }
    }
  }

  return { ok: true, postId: postId!, permalink: `https://www.facebook.com/${postId}` }
}
