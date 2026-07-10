'use client'

import { useRef, useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { freshIdToken } from '@/lib/firebase/client'

// FB 封面截圖（dev mode fallback）：API 發的 FB 影片會被轉 Reel 且一般人看不到
// （實測 /videos 與 /video_reels 都一樣，詳見 docs/content-draft-story-publishing.md）。
// 使用者把播放器拖到想要的畫面按截圖 → server ffmpeg 截 JPEG → FB 改發這張圖，
// IG/Threads 照發影片。Meta App 切 Live 後（META_APP_LIVE）整個元件不再出現。
export function FbCoverPicker({ pageId, videoUrl, cover, onCover }: {
  pageId: string
  videoUrl: string
  cover: string | null
  onCover: (url: string | null) => void
}) {
  const { L } = useLang()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function capture() {
    const at = videoRef.current?.currentTime ?? 0
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/content-drafts/media/frame', {
        method: 'POST', headers: { Authorization: `Bearer ${await freshIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, videoUrl, atSeconds: at }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.imageUrl) throw new Error(d.error ?? L('截圖失敗', 'Capture failed'))
      onCover(d.imageUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : L('截圖失敗', 'Capture failed'))
    } finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-semibold text-gray-700">📷 {L('FB 封面截圖', 'FB cover frame')}</p>
      <p className="mt-0.5 text-xs text-amber-700">
        {L(
          'Meta App 開發模式期間，FB 影片（Reel）僅 App 測試者可見。建議截一張封面圖：FB 將改發這張圖片，IG / Threads 照發影片。不截圖則 FB 照發影片（一般觀眾看不到）。',
          'While the Meta app is in Development mode, FB videos (Reels) are visible to app testers only. Pick a cover frame: FB will post this image instead, while IG / Threads still get the video. Without a cover, FB posts the video (invisible to regular viewers).',
        )}
      </p>
      {cover ? (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" className="h-20 rounded-lg border border-gray-200 object-cover" />
          <div>
            <p className="text-xs font-semibold text-green-700">✓ {L('FB 將發布此封面圖', 'FB will post this cover image')}</p>
            <button onClick={() => onCover(null)} className="mt-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600">
              {L('重選 / 移除', 'Re-pick / remove')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <video ref={videoRef} src={videoUrl} controls muted playsInline className="max-h-48 w-full rounded-lg bg-black" />
          <button disabled={busy} onClick={capture}
            className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-50">
            {busy ? L('截圖中…', 'Capturing…') : L('用目前畫面當 FB 封面', 'Use current frame as FB cover')}
          </button>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}
