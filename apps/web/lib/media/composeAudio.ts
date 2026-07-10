// 音樂合成（Slice 1）：把音訊「燒進」影片檔後再走原有發布流程。
// Meta 官方曲庫不開放 API（版權限制），所以 API 發文要有音樂只能事先合成；
// 在草稿編輯時就合成，讓核准者預覽到的內容＝實際發布的內容（HITL）。
// - 圖片＋音訊 → 12 秒 9:16 影片（blur 背景 + 原圖置中，同 FB Story 規格，
//   FB feed / IG Reels / Threads 都收）
// - 影片＋音訊 → 取代原音軌（-c:v copy 不重編碼，音訊循環補滿、結尾淡出）
// ⚠️ 只能用免版稅/自有音樂 —— 版權歌曲會被 Meta Rights Manager 靜音或限流。

import sharp from 'sharp'
import { createHash, randomUUID } from 'crypto'
import { getStorage } from 'firebase-admin/storage'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const CANVAS_W = 1080
const CANVAS_H = 1920
const IMAGE_VIDEO_SECONDS = 12
const MAX_INPUT_BYTES = 60 * 1024 * 1024   // 60MB：涵蓋一般草稿影片與音檔

async function download(url: string, label: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label} 下載失敗（${res.status}）`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_INPUT_BYTES) throw new Error(`${label} 超過 60MB 上限`)
  return buf
}

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegPath
  if (!bin) throw new Error('ffmpeg-static binary unavailable')
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, ['-y', ...args])
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk).slice(-4000) })
    proc.on('error', reject)
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))
    })
  })
}

async function uploadPublic(path: string, data: Buffer, contentType: string): Promise<string> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'contentloop-dev.firebasestorage.app'
  const token = randomUUID()
  await getStorage().bucket(bucketName).file(path).save(data, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  })
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

const uploadPublicMp4 = (path: string, data: Buffer) => uploadPublic(path, data, 'video/mp4')

// 與 FB Story 相同的 9:16 畫布：模糊放大背景 + 原圖等比置中。
async function to916Canvas(image: Buffer): Promise<Buffer> {
  const background = await sharp(image)
    .resize(CANVAS_W, CANVAS_H, { fit: 'cover' })
    .blur(36)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
  const foreground = await sharp(image)
    .rotate()
    .resize(CANVAS_W, CANVAS_H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  return sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

const H264_ARGS = [
  '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '4.0',
  '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
]
const AAC_ARGS = ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2']

function outName(pageId: string, seed: string): string {
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 12)
  return `generated/composed/${pageId}/${Date.now()}-${hash}.mp4`
}

// 圖片＋音訊 → 12 秒 9:16 MP4。音訊不足 12 秒自動循環，最後 1 秒淡出。
export async function composeImageAudio(pageId: string, imageUrl: string, audioUrl: string): Promise<string> {
  const [image, audio] = await Promise.all([download(imageUrl, '圖片'), download(audioUrl, '音訊')])
  const canvas = await to916Canvas(image)
  const dir = await mkdtemp(join(tmpdir(), 'contentloop-compose-'))
  try {
    const img = join(dir, 'frame.jpg'); const aud = join(dir, 'audio'); const out = join(dir, 'out.mp4')
    await Promise.all([writeFile(img, canvas), writeFile(aud, audio)])
    await runFfmpeg([
      '-loop', '1', '-framerate', '30', '-i', img,
      '-stream_loop', '-1', '-i', aud,
      '-t', String(IMAGE_VIDEO_SECONDS), '-r', '30',
      '-af', `afade=t=out:st=${IMAGE_VIDEO_SECONDS - 1}:d=1`,
      ...H264_ARGS, ...AAC_ARGS, '-movflags', '+faststart', out,
    ])
    return uploadPublicMp4(outName(pageId, imageUrl + audioUrl), await readFile(out))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// 影片截一張影格 → JPEG（FB 封面用：dev mode 期間 FB 影片一般人看不到，
// 改發封面圖；IG/Threads 照發影片）。atSeconds 由使用者在前端播放器挑選。
export async function extractVideoFrame(pageId: string, videoUrl: string, atSeconds: number): Promise<string> {
  const video = await download(videoUrl, '影片')
  const dir = await mkdtemp(join(tmpdir(), 'contentloop-frame-'))
  try {
    const vid = join(dir, 'video'); const out = join(dir, 'frame.jpg')
    await writeFile(vid, video)
    const at = Math.max(0, Number.isFinite(atSeconds) ? atSeconds : 0)
    await runFfmpeg(['-ss', at.toFixed(2), '-i', vid, '-frames:v', '1', '-q:v', '2', out])
    const jpeg = await sharp(await readFile(out)).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    const hash = createHash('sha1').update(videoUrl + at).digest('hex').slice(0, 12)
    return uploadPublic(`generated/fb-covers/${pageId}/${Date.now()}-${hash}.jpg`, jpeg, 'image/jpeg')
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// 影片＋音訊 → 音樂取代原音軌；影片流原樣複製（不重編碼），長度以影片為準。
export async function composeVideoAudio(pageId: string, videoUrl: string, audioUrl: string): Promise<string> {
  const [video, audio] = await Promise.all([download(videoUrl, '影片'), download(audioUrl, '音訊')])
  const dir = await mkdtemp(join(tmpdir(), 'contentloop-compose-'))
  try {
    const vid = join(dir, 'video'); const aud = join(dir, 'audio'); const out = join(dir, 'out.mp4')
    await Promise.all([writeFile(vid, video), writeFile(aud, audio)])
    await runFfmpeg([
      '-i', vid,
      '-stream_loop', '-1', '-i', aud,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', ...AAC_ARGS,
      '-shortest', '-movflags', '+faststart', out,
    ])
    return uploadPublicMp4(outName(pageId, videoUrl + audioUrl), await readFile(out))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
