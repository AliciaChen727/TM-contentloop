'use client'

import { useState, useRef } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { auth } from '@/lib/firebase/client'
import { uploadDraftMedia } from '@/lib/firebase/storage'
import { splitForThreads, THREADS_LIMIT } from '@/lib/publish/threadsSplit'
import { validateItems, hasBlockingErrors } from '@/lib/publish/validateDraft'
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
export function DraftComposer({ pageId, pageName, idToken, onCreate, onClose, busy }: {
  pageId: string
  pageName?: string
  idToken: string
  onCreate: (input: Omit<CreateDraftInput, 'pageId'>) => void
  onClose: () => void
  busy: boolean
}) {
  const { L } = useLang()
  const [targets, setTargets] = useState<DraftTarget[]>(['fb'])
  const [mediaType, setMediaType] = useState<MediaType>('text')
  const [body, setBody] = useState('')                       // shared caption
  const [tailored, setTailored] = useState(false)            // per-platform copy?
  const [perBody, setPerBody] = useState<Record<string, string>>({})  // caption per platform
  const [hashtags, setHashtags] = useState('')
  const [threadsTopic, setThreadsTopic] = useState('')   // Threads topic_tag (single)
  const [mediaUrl, setMediaUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')     // local objectURL for instant preview
  const [previewKind, setPreviewKind] = useState<'image' | 'video'>('image')
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [err, setErr] = useState('')
  const [previewPlat, setPreviewPlat] = useState<DraftTarget>('fb')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [alsoStory, setAlsoStory] = useState(false)
  // Public FB page picture (no token needed for public pages).
  const pageAvatar = `https://graph.facebook.com/${pageId}/picture?type=square&width=64&height=64`
  const fileRef = useRef<HTMLInputElement>(null)

  // Effective caption for a platform: tailored → its own body; else the shared one.
  const eff = (t: DraftTarget) => (tailored ? (perBody[t] ?? '') : body)
  // Preview tab must be one of the selected targets.
  const activePreview: DraftTarget = targets.includes(previewPlat) ? previewPlat : (targets[0] ?? 'fb')
  const editBody = tailored ? (perBody[activePreview] ?? '') : body
  const setEditBody = (v: string) => tailored ? setPerBody(p => ({ ...p, [activePreview]: v })) : setBody(v)

  // Hashtags apply to ALL selected platforms (not just IG); Threads counts them
  // toward its 500-char limit, so include them when computing the split.
  const tags = hashtags.split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean).slice(0, 30)
  const tagLine = tags.map(h => `#${h}`).join(' ')
  const withTags = (b: string) => tagLine ? `${b}\n\n${tagLine}` : b
  // Threads no longer blocks on 500 — overflow auto-splits into a reply chain.
  const thSegs = targets.includes('th') ? splitForThreads(withTags(eff('th'))) : []
  const thWillSplit = thSegs.length > 1
  const needsMedia = mediaType !== 'text'
  const uploading = uploadPct !== null && uploadPct < 100
  const bodiesReady = tailored ? targets.every(t => (perBody[t] ?? '').trim().length > 0) : body.trim().length > 0
  // Platform hard-limit validation (字數/hashtag/媒體) — blocks save on errors.
  const violations = validateItems(targets.map(t => ({
    platform: t, text: eff(t), hashtags: tags, hasMedia: mediaUrl.trim().length > 0, mediaType,
  })))
  const blocked = hasBlockingErrors(violations)
  const canSubmit = targets.length > 0 && bodiesReady && !uploading && !blocked && (!needsMedia || mediaUrl.trim().length > 0)

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
        ? { body: withTags(eff('th')) }
        : { body: eff(t), ...(tags.length ? { hashtags: tags } : {}), ...(needsMedia ? { mediaUrl } : {}) }
      if (t !== 'th' && needsMedia) perPlatform[t]!.mediaUrl = mediaUrl
    }
    const canStory = needsMedia && (targets.includes('fb') || targets.includes('ig'))
    const topic = targets.includes('th') && threadsTopic.trim() ? threadsTopic.trim().replace(/^#/, '') : ''
    onCreate({ target: targets, mediaType, generated: {
      perPlatform, ...(needsMedia ? { mediaUrl } : {}),
      ...(canStory && alsoStory ? { alsoStory: true } : {}),
      ...(topic ? { threadsTopicTag: topic } : {}),
    } })
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
              <label className="text-sm font-semibold text-gray-700">
                {L('文案', 'Caption')}
                {tailored && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-bold text-purple-700">{PLAT_TAB[activePreview]}</span>}
              </label>
              <div className="flex items-center gap-2">
                {targets.includes('th') && <span className={`text-xs font-semibold ${thWillSplit ? 'text-purple-600' : 'text-gray-400'}`}>Threads {eff('th').length}/{TH_LIMIT}</span>}
                <button onClick={() => setShowAiSettings(true)}
                  className="rounded-md bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700">
                  {`✨ ${L('AI 生成文案', 'AI caption')}`}
                </button>
              </div>
            </div>
            {tailored && <p className="mb-1 text-xs text-gray-400">{L('各平台文案不同，用右上預覽切換平台來編輯。', 'Per-platform copy — switch platform via the preview tabs to edit each.')}</p>}
            <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={5}
              placeholder={L('輸入貼文文案，或按「AI 生成文案」…', 'Write a caption, or use "AI caption"…')}
              className="w-full resize-y rounded-lg border border-gray-200 p-3 text-sm text-gray-800" />
            {thWillSplit && <p className="mt-1 text-xs text-purple-600">🧵 {L(`Threads 超過 500 字，將自動切成 ${thSegs.length} 則（1 主貼 + ${thSegs.length - 1} 則留言）。`, `Over 500 chars — Threads auto-splits into ${thSegs.length} (1 main + ${thSegs.length - 1} replies).`)}</p>}

            {targets.length > 0 && (
              <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder={L('Hashtags（套用所有平台，空白分隔；IG ≤30）', 'Hashtags (all platforms, space-separated; IG ≤30)')}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            )}
            {targets.includes('th') && (
              <input value={threadsTopic} onChange={e => setThreadsTopic(e.target.value)} placeholder={L('Threads 主題標籤（選填，單一，用於分類/被搜尋）', 'Threads topic tag (optional, single)')}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            )}

            {/* Story is time-sensitive → opt-in separately, not a media type.
                Needs media + FB/IG (Threads has no stories). */}
            {needsMedia && (targets.includes('fb') || targets.includes('ig')) && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
                <input type="checkbox" checked={alsoStory} onChange={e => setAlsoStory(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>
                  <span className="block text-sm font-semibold text-gray-700">📸 {L('同時發佈限動 Story', 'Also post as Story')}</span>
                  <span className="block text-xs text-gray-400">{L('把這則媒體同時發成 24 小時限動（時效性內容）。', 'Also publish this media as a 24h Story.')}</span>
                  {alsoStory && (
                    <span className="mt-1 block text-xs font-semibold text-pink-600">
                      {L('限動將發佈到：', 'Story will post to: ')}
                      {targets.filter(t => t === 'fb' || t === 'ig').map(t => t === 'ig' ? 'Instagram' : 'Facebook').join(L('、', ', '))}
                    </span>
                  )}
                </span>
              </label>
            )}
            {/* Hide the obvious "empty caption" nag; show the informative ones. */}
            {(() => {
              const shown = violations.filter(v => v.code !== 'empty')
              return shown.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {shown.map((v, i) => (
                    <li key={i} className={`flex items-start gap-1 text-xs ${v.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                      <span>{v.severity === 'error' ? '⛔' : '⚠️'}</span>{v.message}
                    </li>
                  ))}
                </ul>
              )
            })()}
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          </div>

          {/* RIGHT — live preview with per-platform toggle (only selected targets) */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-gray-700">{L('預覽', 'Preview')}</label>
              <div className="flex items-center gap-2">
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
                {/* Device preview toggle (desktop / mobile), like Meta's composer. */}
                <div className="flex overflow-hidden rounded-lg border border-gray-200">
                  <button onClick={() => setPreviewDevice('desktop')} aria-label={L('桌機預覽', 'Desktop')}
                    className={`px-2 py-1.5 ${previewDevice === 'desktop' ? 'bg-gray-900 text-white' : 'text-gray-500'}`}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 17h6M10 13.5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                  <button onClick={() => setPreviewDevice('mobile')} aria-label={L('手機預覽', 'Mobile')}
                    className={`px-2 py-1.5 ${previewDevice === 'mobile' ? 'bg-gray-900 text-white' : 'text-gray-500'}`}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6" y="2.5" width="8" height="15" rx="1.6" stroke="currentColor" strokeWidth="1.5"/><path d="M9 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
            {targets.length === 0
              ? <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">{L('請先選發布平台', 'Select a platform')}</div>
              : (
                <div className={previewDevice === 'mobile' ? 'mx-auto max-w-[340px]' : ''}>
                  <PostPreview platform={activePreview} body={eff(activePreview)} mediaUrl={previewUrl || mediaUrl} mediaKind={previewKind} hashtags={tags} showMedia={!!showMedia} pageName={pageName} pageAvatar={pageAvatar} />
                </div>
              )}
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
          pageId={pageId} idToken={idToken} targets={targets} mediaType={mediaType} seed={tailored ? (perBody[activePreview] ?? '') : body}
          onGenerated={r => {
            if (r.perPlatform) { setTailored(true); setPerBody(p => ({ ...p, ...r.perPlatform })) }
            else { setTailored(false); setBody(r.shared ?? '') }
            setShowAiSettings(false)
          }}
          onClose={() => setShowAiSettings(false)}
        />
      )}
    </div>
  )
}
