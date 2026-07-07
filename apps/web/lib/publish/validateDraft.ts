// Draft validation (Agent 自動發布 S3). Pure — shared by the composer (inline
// red, blocks save), the create API (server-side guard), and later the publish
// guard. Single source of truth = platformSpecs. `error` blocks; `warn` informs.

import type { DraftTarget, MediaType } from '@/lib/content/draftTypes'
import { PLATFORM_SPECS } from './platformSpecs'

export type ViolationCode = 'empty' | 'text_max' | 'media_required' | 'media_missing' | 'hashtag_max' | 'banned' | 'fb_mixed_carousel' | 'fb_video_carousel'

export interface Violation {
  platform: DraftTarget
  field: 'text' | 'media' | 'hashtags'
  code: ViolationCode
  severity: 'error' | 'warn'
  message: string
  limit?: number
  actual?: number
}

// One item per platform = exactly what will be published there.
export interface ValidationItem {
  platform: DraftTarget
  text: string
  hashtags: string[]
  hasMedia: boolean
  mediaType: MediaType
  mediaUrls?: string[]   // for carousels — used to detect FB mixed image+video
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)

const PLAT_ZH: Record<DraftTarget, string> = { fb: 'Facebook', ig: 'Instagram', th: 'Threads' }

export function validateItems(items: ValidationItem[], opts?: { bannedWords?: string[] }): Violation[] {
  const out: Violation[] = []
  const banned = (opts?.bannedWords ?? []).map(w => w.trim()).filter(Boolean)

  for (const it of items) {
    const spec = PLATFORM_SPECS[it.platform]
    const name = PLAT_ZH[it.platform]
    const text = it.text ?? ''

    if (!text.trim()) {
      out.push({ platform: it.platform, field: 'text', code: 'empty', severity: 'error', message: `${name}：文案不可空白` })
    }
    // Text cap — Threads auto-splits, so its cap isn't an error.
    if (!spec.autoSplit && text.length > spec.textMax) {
      out.push({ platform: it.platform, field: 'text', code: 'text_max', severity: 'error', message: `${name}：文案超過 ${spec.textMax} 字上限`, limit: spec.textMax, actual: text.length })
    }
    // Media requirement (IG can't post text-only).
    if (spec.mediaRequired && !it.hasMedia) {
      out.push({ platform: it.platform, field: 'media', code: 'media_required', severity: 'error', message: `${name}：需要圖片或影片（不支援純文字貼文）` })
    }
    // A non-text media type must actually carry media.
    else if (it.mediaType !== 'text' && !it.hasMedia) {
      out.push({ platform: it.platform, field: 'media', code: 'media_missing', severity: 'error', message: `${name}：媒體型態為「${it.mediaType}」但尚未上傳素材` })
    }
    // Hashtag cap (IG ≤30).
    if (spec.hashtagMax != null && it.hashtags.length > spec.hashtagMax) {
      out.push({ platform: it.platform, field: 'hashtags', code: 'hashtag_max', severity: 'error', message: `${name}：hashtag 超過 ${spec.hashtagMax} 個上限（目前 ${it.hashtags.length}）`, limit: spec.hashtagMax, actual: it.hashtags.length })
    }
    // FB carousel can't mix photos + videos (feed multi-media = photos only).
    if (it.platform === 'fb' && it.mediaType === 'carousel') {
      const urls = it.mediaUrls ?? []
      const hasVid = urls.some(isVideoUrl)
      const hasImg = urls.some(u => !isVideoUrl(u))
      if (hasVid && hasImg) {
        out.push({ platform: 'fb', field: 'media', code: 'fb_mixed_carousel', severity: 'warn', message: 'Facebook 輪播不支援圖片＋影片混合，發布時影片會被略過（建議影片另發，或 FB 只放相片）' })
      } else if (hasVid && !hasImg) {
        out.push({ platform: 'fb', field: 'media', code: 'fb_video_carousel', severity: 'error', message: 'Facebook 輪播僅支援多張相片（目前全是影片），請改用相片或取消勾選 Facebook' })
      }
    }
    // Banned words (brand pre-check) — warn, don't block.
    for (const w of banned) {
      if (text.includes(w)) out.push({ platform: it.platform, field: 'text', code: 'banned', severity: 'warn', message: `${name}：含禁詞「${w}」` })
    }
  }
  return out
}

export function hasBlockingErrors(violations: Violation[]): boolean {
  return violations.some(v => v.severity === 'error')
}
