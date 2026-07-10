'use client'

import { useLang } from '@/lib/i18n/LanguageProvider'
import type { MediaItem } from './PostPreview'

// IG Story 預覽：9:16 黑底畫布 + 頂部進度條/頭像，媒體 contain 置中（IG 對
// 非 9:16 媒體就是上下留黑邊）。忠實反映 publishIgStory 的實際行為：
// Story 不帶文案、輪播只取第一個媒體。
export function StoryPreview({ mediaItems, pageName, pageAvatar }: {
  mediaItems: MediaItem[]
  pageName?: string
  pageAvatar?: string
}) {
  const { L } = useLang()
  const first = mediaItems[0]
  return (
    <div>
      <div className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '9 / 16' }}>
        {first ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {first.kind === 'video'
              ? <video src={first.url} controls className="max-h-full w-full object-contain" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={first.url} alt="" className="max-h-full w-full object-contain" />}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-4xl text-gray-600">🖼️</div>
        )}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-2 pb-6">
          <div className="mb-2 h-0.5 w-full rounded-full bg-white/30"><div className="h-full w-1/3 rounded-full bg-white" /></div>
          <div className="flex items-center gap-2">
            {pageAvatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={pageAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              : <div className="h-7 w-7 rounded-full bg-white/30" />}
            <span className="text-xs font-semibold text-white">{pageName || '@your_page'}</span>
            <span className="text-[10px] text-white/70">{L('剛剛', 'now')}</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-gray-400">
        {L('限動只有媒體、不帶文案；24 小時後消失。', 'Stories carry media only — no caption; gone after 24h.')}
        {mediaItems.length > 1 && ` ${L('輪播限動只取第一張。', 'Carousel stories use the first item only.')}`}
      </p>
    </div>
  )
}
