'use client'

import { useRef, useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { auth, freshIdToken } from '@/lib/firebase/client'
import { uploadDraftMedia } from '@/lib/firebase/storage'

// 草稿加音樂（Slice 1）：上傳音檔 → server 端 ffmpeg 合成 → 回傳新影片 URL。
// 圖片會轉成 12 秒 9:16 影片；影片的原聲會被音樂取代。合成結果直接成為草稿
// 媒體，預覽即發布內容。Meta 官方曲庫不開放 API，僅支援自備音檔。
export function AudioComposer({ idToken, pageId, media, hasMusic, onComposed, onRestore }: {
  idToken: string
  pageId: string
  media: { url: string; kind: 'image' | 'video' } | null
  hasMusic: boolean
  onComposed: (videoUrl: string) => void
  onRestore: () => void
}) {
  const { L } = useLang()
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'composing'>('idle')
  const [err, setErr] = useState('')

  async function onAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    const uid = auth.currentUser?.uid
    if (!file || !media || !uid) return
    if (file.size > 20 * 1024 * 1024) { setErr(L('音檔請小於 20MB', 'Audio must be under 20MB')); return }
    setErr('')
    try {
      setPhase('uploading')
      const audioUrl = await uploadDraftMedia(uid, file)
      setPhase('composing')
      const res = await fetch('/api/content-drafts/media/compose', {
        method: 'POST', headers: { Authorization: `Bearer ${(await freshIdToken()) || idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, mediaUrl: media.url, audioUrl, kind: media.kind }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.videoUrl) throw new Error(d.error ?? L('合成失敗', 'compose failed'))
      onComposed(d.videoUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : L('合成失敗', 'compose failed'))
    } finally {
      setPhase('idle')
    }
  }

  if (!media && !hasMusic) return null
  const busy = phase !== 'idle'
  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-700">🎵 {L('背景音樂', 'Music')}</span>
        {hasMusic ? (
          <>
            <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">{L('已加上音樂', 'Music added')}</span>
            <button onClick={onRestore} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600">
              {L('移除音樂（還原媒體）', 'Remove music (restore media)')}
            </button>
          </>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" onChange={onAudioFile} className="hidden" />
            <button disabled={busy} onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 disabled:opacity-50">
              {phase === 'uploading' ? L('上傳音檔中…', 'Uploading…')
                : phase === 'composing' ? L('合成中（約 10–30 秒）…', 'Composing (~10–30s)…')
                : L('上傳音檔加入音樂', 'Add music from an audio file')}
            </button>
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {media?.kind === 'image' && !hasMusic
          ? L('圖片會轉成 12 秒 9:16 影片（模糊背景置中版面）發布；', 'The image becomes a 12s 9:16 video (blurred background); ')
          : media?.kind === 'video' && !hasMusic
            ? L('音樂會取代影片原本的聲音；', 'The music replaces the original audio track; ')
            : ''}
        {L('請使用免版稅或自有音樂 —— 版權歌曲會被 Meta 偵測並靜音或限流。', 'Use royalty-free or owned music — copyrighted tracks get muted or throttled by Meta.')}
      </p>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}
