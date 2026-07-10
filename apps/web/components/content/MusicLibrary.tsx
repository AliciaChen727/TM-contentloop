'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { freshIdToken } from '@/lib/firebase/client'

interface Track { id: string; name: string; url: string }

// 曲庫選用（composer 端，唯讀）：列出粉專曲庫、試聽、選一首去合成。
// 曲庫的上傳/命名/移除在「廣告儀表板 → 品牌素材庫」的音樂曲庫卡片
// （components/analytics/MusicLibraryCard.tsx）。
export function MusicLibrary({ pageId, disabled, onPick }: {
  pageId: string
  disabled: boolean
  onPick: (url: string) => void
}) {
  const { L } = useLang()
  const [open, setOpen] = useState(false)
  const [tracks, setTracks] = useState<Track[] | null>(null)   // null = 未載入
  const [err, setErr] = useState('')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || tracks !== null) return
    try {
      const res = await fetch(`/api/content-drafts/music?pageId=${encodeURIComponent(pageId)}`, {
        headers: { Authorization: `Bearer ${await freshIdToken()}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? L('讀取曲庫失敗', 'Failed to load library'))
      setTracks((d.tracks ?? []) as Track[])
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); setTracks([]) }
  }

  return (
    <div className="mt-2">
      <button onClick={toggle} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600">
        📚 {L('從曲庫選擇', 'Pick from library')} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-2">
          {tracks === null && <p className="text-xs text-gray-400">{L('載入中…', 'Loading…')}</p>}
          {tracks?.length === 0 && (
            <p className="text-xs text-gray-400">
              {L('曲庫還是空的 —— 到「廣告儀表板 → 品牌素材庫」上傳免版稅音樂。', 'Library is empty — upload royalty-free tracks in Ads Dashboard → Brand Asset Library.')}
            </p>
          )}
          {tracks?.map(t => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{t.name}</span>
              <audio src={t.url} controls preload="none" className="h-8 w-44" />
              <button disabled={disabled} onClick={() => onPick(t.url)}
                className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50">
                {L('用這首', 'Use')}
              </button>
            </div>
          ))}
          {(tracks?.length ?? 0) > 0 && (
            <p className="text-[11px] text-gray-400">{L('管理曲庫（上傳/移除）請到「廣告儀表板 → 品牌素材庫」。', 'Manage tracks (upload/remove) in Ads Dashboard → Brand Asset Library.')}</p>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  )
}
