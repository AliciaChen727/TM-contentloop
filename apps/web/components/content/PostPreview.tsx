'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import type { DraftTarget } from '@/lib/content/draftTypes'
import { splitForThreads } from '@/lib/publish/threadsSplit'

const PLAT_META: Record<DraftTarget, { fallbackName: string; accent: string }> = {
  fb: { fallbackName: '你的粉專', accent: '#1877F2' },
  ig: { fallbackName: '@your_page', accent: '#C13584' },
  th: { fallbackName: '@your_page', accent: '#000000' },
}
const IG_CAPTION_LIMIT = 125   // IG folds the caption after ~125 chars with "…more"

type MediaItem = { url: string; kind: 'image' | 'video' }

function One({ url, kind, crop }: { url: string; kind: 'image' | 'video'; crop?: '4/5' | '1/1' }) {
  // Cap height so a wide preview panel doesn't blow media up. Cropped (IG) keeps
  // its aspect but is bounded; uncropped letterboxes (contain).
  const style: React.CSSProperties = crop
    ? { aspectRatio: crop.replace('/', ' / '), objectFit: 'cover', maxHeight: 340, width: '100%' }
    : { maxHeight: 280, width: '100%', objectFit: 'contain', background: '#fff' }
  if (kind === 'video') return <video src={url} controls className="rounded-lg" style={style} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="rounded-lg" style={style} />
  )
}

// Renders a single item or a swipeable carousel strip (2–10). Empty → placeholder.
// Carousel slides are uniform squares (object-cover) so mixed orientations read
// as a tidy filmstrip — approximating Threads' one-at-a-time swipe.
function Media({ items, crop }: { items: MediaItem[]; crop?: '4/5' | '1/1' }) {
  if (items.length === 0) return <div className="flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-4xl text-gray-300">🖼️</div>
  if (items.length === 1) return <One url={items[0].url} kind={items[0].kind} crop={crop} />
  return (
    <div className="relative">
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {items.map((m, i) => (
          <div key={i} className="h-44 w-44 flex-shrink-0 snap-center overflow-hidden rounded-lg bg-gray-50">
            {m.kind === 'video'
              ? <video src={m.url} controls className="h-full w-full object-cover" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={m.url} alt="" className="h-full w-full object-cover" />}
          </div>
        ))}
      </div>
      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">1/{items.length} ▸</span>
    </div>
  )
}

function Avatar({ accent, url }: { accent: string; url?: string }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
  }
  return <div className="h-8 w-8 flex-shrink-0 rounded-full" style={{ background: accent, opacity: 0.25 }} />
}

// Platform-accurate preview: real page name/avatar, platform-specific caption
// truncation ("查看更多"/"…更多"), IG media crop, and the Threads reply-chain split.
export function PostPreview({ platform, body, mediaItems, hashtags, showMedia, pageName, pageAvatar }: {
  platform: DraftTarget
  body: string
  mediaItems: MediaItem[]
  hashtags?: string[]
  showMedia: boolean
  pageName?: string
  pageAvatar?: string
}) {
  const { L } = useLang()
  const [expanded, setExpanded] = useState(false)
  const m = PLAT_META[platform]
  const name = pageName || m.fallbackName
  const tagLine = (hashtags?.length ?? 0) > 0 ? hashtags!.slice(0, 30).map(h => `#${h}`).join(' ') : ''
  const More = ({ label }: { label: string }) => (
    <button onClick={() => setExpanded(v => !v)} className="text-gray-400 hover:text-gray-600">{expanded ? L('收起', 'less') : label}</button>
  )

  // Threads: split into a post + reply chain when over the 500-char limit.
  if (platform === 'th') {
    const full = tagLine ? `${body}\n\n${tagLine}` : body
    const segs = splitForThreads(full)
    const parts = segs.length ? segs : ['']
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        {parts.map((seg, i) => (
          <div key={i} className="relative flex gap-2 pb-3">
            <div className="flex flex-col items-center">
              <Avatar accent={m.accent} url={pageAvatar} />
              {i < parts.length - 1 && <div className="mt-1 w-0.5 flex-1 bg-gray-200" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-800">{name}</span>
                {i === 0
                  ? <span className="text-[10px] text-gray-400">{L('剛剛', 'now')}</span>
                  : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{L(`留言 ${i}`, `Reply ${i}`)}</span>}
              </div>
              {seg ? <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{seg}</p> : <p className="mt-1 text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
              {i === 0 && showMedia && <div className="mt-2"><Media items={mediaItems} /></div>}
            </div>
          </div>
        ))}
        {parts.length > 1 && (
          <p className="mt-1 text-xs font-semibold" style={{ color: m.accent }}>🧵 {L(`將發成 ${parts.length} 則（1 主貼 + ${parts.length - 1} 則留言）`, `Posts as ${parts.length} (1 main + ${parts.length - 1} replies)`)}</p>
        )}
      </div>
    )
  }

  // Instagram: media-first (cropped 4:5), caption folds after 125 chars.
  if (platform === 'ig') {
    const long = body.length > IG_CAPTION_LIMIT
    const shown = long && !expanded ? body.slice(0, IG_CAPTION_LIMIT) : body
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-2"><Avatar accent={m.accent} url={pageAvatar} /><span className="text-xs font-bold text-gray-800">{name}</span></div>
        {showMedia && <div className="mb-2"><Media items={mediaItems} crop="4/5" /></div>}
        {body
          ? <p className="whitespace-pre-wrap text-sm text-gray-800">{shown}{long && !expanded && '… '}{long && <More label={L('更多', 'more')} />}</p>
          : <p className="text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
        {tagLine && <p className="mt-1 text-xs text-blue-600">{tagLine}</p>}
      </div>
    )
  }

  // Facebook: header + caption folds after ~3 lines, then media.
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar accent={m.accent} url={pageAvatar} />
        <div><div className="text-xs font-bold text-gray-800">{name}</div><div className="text-[10px] text-gray-400">{L('剛剛', 'Just now')} · 🌐</div></div>
      </div>
      {body
        ? <p className={`mb-1 whitespace-pre-wrap text-sm text-gray-800 ${expanded ? '' : 'line-clamp-3'}`}>{body}</p>
        : <p className="mb-2 text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
      {body && (body.length > 120 || body.split('\n').length > 3) && <p className="mb-2 text-sm"><More label={L('查看更多', 'See more')} /></p>}
      {tagLine && <p className="mb-2 text-xs text-blue-600">{tagLine}</p>}
      {showMedia && <Media items={mediaItems} />}
    </div>
  )
}
