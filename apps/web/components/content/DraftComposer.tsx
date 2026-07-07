'use client'

import { useState, useRef } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { auth } from '@/lib/firebase/client'
import { uploadDraftMedia } from '@/lib/firebase/storage'
import { splitForThreads, THREADS_LIMIT } from '@/lib/publish/threadsSplit'
import { PostPreview } from './PostPreview'
import { CaptionSettings } from './CaptionSettings'
import type { DraftTarget, MediaType, CreateDraftInput } from '@/lib/content/draftTypes'

const TARGETS: { key: DraftTarget; label: string }[] = [
  { key: 'fb', label: 'Facebook' }, { key: 'ig', label: 'Instagram' }, { key: 'th', label: 'Threads' },
]
const PLAT_TAB: Record<DraftTarget, string> = { fb: 'FB', ig: 'IG', th: 'Threads' }
const TH_LIMIT = THREADS_LIMIT

// Manual draft composer (S2+). Upload image/video with live preview, optional
// AI caption generation (copy-only, no image quota), then save as `draft`.
export function DraftComposer({ pageId, idToken, onCreate, onClose, busy }: {
  pageId: string
  idToken: string
  onCreate: (input: Omit<CreateDraftInput, 'pageId'>) => void
  onClose: () => void
  busy: boolean
}) {
  const { L } = useLang()
  const [targets, setTargets] = useState<DraftTarget[]>(['fb'])
  const [mediaType, setMediaType] = useState<MediaType>('text')
  const [body, setBody] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')     // local objectURL for instant preview
  const [previewKind, setPreviewKind] = useState<'image' | 'video'>('image')
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [err, setErr] = useState('')
  const [previewPlat, setPreviewPlat] = useState<DraftTarget>('fb')
  const fileRef = useRef<HTMLInputElement>(null)

  // Hashtags apply to ALL selected platforms (not just IG); Threads counts them
  // toward its 500-char limit, so include them when computing the split.
  const tags = hashtags.split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean).slice(0, 30)
  const tagLine = tags.map(h => `#${h}`).join(' ')
  const bodyWithTags = tagLine ? `${body}\n\n${tagLine}` : body
  // Threads no longer blocks on 500 — overflow auto-splits into a reply chain.
  const thSegs = targets.includes('th') ? splitForThreads(bodyWithTags) : []
  const thWillSplit = thSegs.length > 1
  const needsMedia = mediaType !== 'text'
  const uploading = uploadPct !== null && uploadPct < 100
  const canSubmit = targets.length > 0 && body.trim().length > 0 && !uploading && (!needsMedia || mediaUrl.trim().length > 0)
  // Preview tab must be one of the selected targets.
  const activePreview: DraftTarget = targets.includes(previewPlat) ? previewPlat : (targets[0] ?? 'fb')

  function toggle(t: DraftTarget) {
    setTargets(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t])
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image'
    setPreviewKind(kind)
    setPreviewUrl(URL.createObjectURL(file))          // instant local preview
    const uid = auth.currentUser?.uid
    if (!uid) { setErr(L('請重新登入', 'Please re-login')); return }
    try {
      setUploadPct(0)
      const url = await uploadDraftMedia(uid, file, pct => setUploadPct(pct))
      setMediaUrl(url); setUploadPct(100)
    } catch { setErr(L('上傳失敗', 'Upload failed')); setUploadPct(null) }
  }

  function submit() {
    const perPlatform: CreateDraftInput['generated']['perPlatform'] = {}
    for (const t of targets) {
      // Hashtags go to every platform now. Threads keeps them inline in the body
      // (so the reply-chain split counts them); FB/IG carry them as a field.
      perPlatform[t] = t === 'th'
        ? { body: bodyWithTags }
        : { body, ...(tags.length ? { hashtags: tags } : {}), ...(needsMedia ? { mediaUrl } : {}) }
      if (t !== 'th' && needsMedia) perPlatform[t]!.mediaUrl = mediaUrl
    }
    onCreate({ target: targets, mediaType, generated: { perPlatform, ...(needsMedia ? { mediaUrl } : {}) } })
  }

  const showMedia = needsMedia && (previewUrl || mediaUrl)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-gray-900">✍️ {L('新增內容草稿', 'New content draft')}</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {/* LEFT — form */}
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">{L('發布平台', 'Platforms')}</label>
            <div className="mb-4 flex gap-2">
              {TARGETS.map(t => (
                <button key={t.key} onClick={() => toggle(t.key)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${targets.includes(t.key) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-sm font-semibold text-gray-700">{L('媒體型態', 'Media type')}</label>
            <select value={mediaType} onChange={e => setMediaType(e.target.value as MediaType)}
              className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800">
              <option value="text">{L('純文字', 'Text')}</option>
              <option value="image">{L('單圖', 'Image')}</option>
              <option value="carousel">{L('輪播', 'Carousel')}</option>
              <option value="video">{L('影片', 'Video')}</option>
              <option value="reels">Reels</option>
              <option value="story">Story</option>
            </select>

            {needsMedia && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-semibold text-gray-700">{L('影音素材', 'Media')}</label>
                <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden" />
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:border-blue-300">
                  🖼️ {L('新增相片 / 影片', 'Add photo / video')}
                </button>
                {uploading && <p className="mt-1 text-xs text-blue-600">{L('上傳中', 'Uploading')} {Math.round(uploadPct ?? 0)}%</p>}
                {uploadPct === 100 && <p className="mt-1 text-xs text-green-600">✓ {L('已上傳', 'Uploaded')}</p>}
                <input value={mediaUrl} onChange={e => { setMediaUrl(e.target.value); setPreviewUrl(e.target.value) }}
                  placeholder={L('或貼上公開媒體 URL', 'or paste a public media URL')}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700" />
              </div>
            )}

            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">{L('文案', 'Caption')}</label>
              <div className="flex items-center gap-2">
                {targets.includes('th') && <span className={`text-xs font-semibold ${thWillSplit ? 'text-purple-600' : 'text-gray-400'}`}>Threads {body.length}/{TH_LIMIT}</span>}
                <button onClick={() => setShowAiSettings(true)}
                  className="rounded-md bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700">
                  {`✨ ${L('AI 生成文案', 'AI caption')}`}
                </button>
              </div>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
              placeholder={L('輸入貼文文案，或按「AI 生成文案」…', 'Write a caption, or use "AI caption"…')}
              className="w-full resize-y rounded-lg border border-gray-200 p-3 text-sm text-gray-800" />
            {thWillSplit && <p className="mt-1 text-xs text-purple-600">🧵 {L(`Threads 超過 500 字，將自動切成 ${thSegs.length} 則（1 主貼 + ${thSegs.length - 1} 則留言）。`, `Over 500 chars — Threads auto-splits into ${thSegs.length} (1 main + ${thSegs.length - 1} replies).`)}</p>}

            {targets.length > 0 && (
              <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder={L('Hashtags（套用所有平台，空白分隔；IG ≤30）', 'Hashtags (all platforms, space-separated; IG ≤30)')}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            )}
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          </div>

          {/* RIGHT — live preview with per-platform toggle (only selected targets) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">{L('預覽', 'Preview')}</label>
              {targets.length > 0 && (
                <div className="flex gap-1">
                  {targets.map(t => (
                    <button key={t} onClick={() => setPreviewPlat(t)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${activePreview === t ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500'}`}>
                      {PLAT_TAB[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {targets.length === 0
              ? <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">{L('請先選發布平台', 'Select a platform')}</div>
              : <PostPreview platform={activePreview} body={body} mediaUrl={previewUrl || mediaUrl} mediaKind={previewKind} hashtags={hashtags.split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean)} showMedia={!!showMedia} />}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600">{L('取消', 'Cancel')}</button>
          <button disabled={!canSubmit || busy} onClick={submit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? L('儲存中…', 'Saving…') : L('存為草稿', 'Save as draft')}
          </button>
        </div>
      </div>

      {showAiSettings && (
        <CaptionSettings
          pageId={pageId} idToken={idToken} targets={targets} mediaType={mediaType} seed={body}
          onGenerated={c => { setBody(c); setShowAiSettings(false) }}
          onClose={() => setShowAiSettings(false)}
        />
      )}
    </div>
  )
}
