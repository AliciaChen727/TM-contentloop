'use client'

import { useLang } from '@/lib/i18n/LanguageProvider'
import type { DraftTarget } from '@/lib/content/draftTypes'
import { splitForThreads } from '@/lib/publish/threadsSplit'

const PLAT_META: Record<DraftTarget, { name: string; handle: string; accent: string }> = {
  fb: { name: 'Facebook 動態', handle: '你的粉專', accent: '#1877F2' },
  ig: { name: 'Instagram', handle: '@your_page', accent: '#C13584' },
  th: { name: 'Threads', handle: '@your_page', accent: '#000000' },
}

function Media({ url, kind }: { url: string; kind: 'image' | 'video' }) {
  if (!url) return <div className="flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-4xl text-gray-300">🖼️</div>
  return kind === 'video'
    ? <video src={url} controls className="w-full rounded-lg" style={{ maxHeight: 280 }} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={url} alt="" className="w-full rounded-lg object-contain" style={{ maxHeight: 280, background: '#fff' }} />
}

function Avatar({ accent }: { accent: string }) {
  return <div className="h-8 w-8 flex-shrink-0 rounded-full" style={{ background: accent, opacity: 0.25 }} />
}

// Platform-accurate preview. Threads renders the reply-chain split when the
// caption exceeds 500 chars (主貼 + 留言…). FB/IG show a single card.
export function PostPreview({ platform, body, mediaUrl, mediaKind, hashtags, showMedia }: {
  platform: DraftTarget
  body: string
  mediaUrl: string
  mediaKind: 'image' | 'video'
  hashtags?: string[]
  showMedia: boolean
}) {
  const { L } = useLang()
  const m = PLAT_META[platform]
  const tagLine = (hashtags?.length ?? 0) > 0 ? hashtags!.slice(0, 30).map(h => `#${h}`).join(' ') : ''

  // Threads: split into a post + reply chain when over the 500-char limit.
  // Hashtags are appended into the text so they count toward the 500 limit.
  if (platform === 'th') {
    const full = tagLine ? `${body}\n\n${tagLine}` : body
    const segs = splitForThreads(full)
    const parts = segs.length ? segs : ['']
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        {parts.map((seg, i) => (
          <div key={i} className="relative flex gap-2 pb-3">
            <div className="flex flex-col items-center">
              <Avatar accent={m.accent} />
              {i < parts.length - 1 && <div className="mt-1 w-0.5 flex-1 bg-gray-200" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-800">{m.handle}</span>
                {i === 0
                  ? <span className="text-[10px] text-gray-400">{L('剛剛', 'now')}</span>
                  : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{L(`留言 ${i}`, `Reply ${i}`)}</span>}
              </div>
              {seg ? <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{seg}</p> : <p className="mt-1 text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
              {i === 0 && showMedia && <div className="mt-2"><Media url={mediaUrl} kind={mediaKind} /></div>}
            </div>
          </div>
        ))}
        {parts.length > 1 && (
          <p className="mt-1 text-xs font-semibold" style={{ color: m.accent }}>🧵 {L(`將發成 ${parts.length} 則（1 主貼 + ${parts.length - 1} 則留言）`, `Posts as ${parts.length} (1 main + ${parts.length - 1} replies)`)}</p>
        )}
      </div>
    )
  }

  // Instagram: media-first, caption below with hashtags.
  if (platform === 'ig') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-2"><Avatar accent={m.accent} /><span className="text-xs font-bold text-gray-800">{m.handle}</span></div>
        {showMedia && <div className="mb-2"><Media url={mediaUrl} kind={mediaKind} /></div>}
        {body ? <p className="whitespace-pre-wrap text-sm text-gray-800">{body}</p> : <p className="text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
        {tagLine && <p className="mt-1 text-xs text-blue-600">{tagLine}</p>}
      </div>
    )
  }

  // Facebook: header + caption + media.
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar accent={m.accent} />
        <div><div className="text-xs font-bold text-gray-800">{m.handle}</div><div className="text-[10px] text-gray-400">{L('剛剛', 'Just now')} · 🌐</div></div>
      </div>
      {body ? <p className="mb-2 whitespace-pre-wrap text-sm text-gray-800">{body}</p> : <p className="mb-2 text-sm text-gray-400">{L('文案預覽…', 'Caption preview…')}</p>}
      {tagLine && <p className="mb-2 text-xs text-blue-600">{tagLine}</p>}
      {showMedia && <Media url={mediaUrl} kind={mediaKind} />}
    </div>
  )
}
