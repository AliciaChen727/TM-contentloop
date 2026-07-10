'use client'

import { useState, useRef } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { auth } from '@/lib/firebase/client'
import { uploadDraftMedia } from '@/lib/firebase/storage'
import { splitForThreads, THREADS_LIMIT } from '@/lib/publish/threadsSplit'
import { validateItems, hasBlockingErrors } from '@/lib/publish/validateDraft'
import { FB_STORY_ENABLED, FB_VIDEO_ENABLED } from '@/lib/content/fbStoryFlag'
import { PostPreview } from './PostPreview'
import { StoryPreview } from './StoryPreview'
import { AudioComposer } from './AudioComposer'
import { FbCoverPicker } from './FbCoverPicker'
import { CaptionSettings } from './CaptionSettings'
import type { DraftTarget, MediaType, CreateDraftInput } from '@/lib/content/draftTypes'
import type { TaggableEntity, TaggingSelection } from '@/lib/tagging/types'

const TARGETS: { key: DraftTarget; label: string }[] = [
  { key: 'fb', label: 'Facebook' }, { key: 'ig', label: 'Instagram' }, { key: 'th', label: 'Threads' },
]
const PLAT_TAB: Record<DraftTarget, string> = { fb: 'FB', ig: 'IG', th: 'Threads' }
const TH_LIMIT = THREADS_LIMIT

// Manual draft composer (S2+). Upload image/video with live preview, optional
// AI caption generation (copy-only, no image quota), then save as `draft`.
export function DraftComposer({ pageId, pageName, idToken, onCreate, onClose, busy, threadsAvailable = true, instagramAvailable = true, taggableEntities = [], onSyncTaggableEntities, onTaggableEntityCreated }: {
  pageId: string
  pageName?: string
  idToken: string
  onCreate: (input: Omit<CreateDraftInput, 'pageId'>) => void
  onClose: () => void
  busy: boolean
  threadsAvailable?: boolean
  instagramAvailable?: boolean
  taggableEntities?: TaggableEntity[]
  onSyncTaggableEntities?: () => void
  onTaggableEntityCreated?: (entity: TaggableEntity) => void
}) {
  const { L } = useLang()
  const [targets, setTargets] = useState<DraftTarget[]>(['fb'])
  const [mediaType, setMediaType] = useState<MediaType>('text')
  const [body, setBody] = useState('')                       // shared caption
  const [tailored, setTailored] = useState(false)            // per-platform copy?
  const [perBody, setPerBody] = useState<Record<string, string>>({})  // caption per platform
  const [hashtags, setHashtags] = useState('')
  const [threadsTopic, setThreadsTopic] = useState('')   // Threads topic_tag (single)
  // Media items: single (image/video) or up to 10 for a carousel.
  const [media, setMedia] = useState<{ url: string; kind: 'image' | 'video'; preview: string }[]>([])
  const [pasteUrl, setPasteUrl] = useState('')
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [uploadQueue, setUploadQueue] = useState<{ total: number; done: number } | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [err, setErr] = useState('')
  const [previewPlat, setPreviewPlat] = useState<DraftTarget>('fb')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewStory, setPreviewStory] = useState(false)   // IG Story 預覽 tab
  // 音樂合成前的原始媒體（供「移除音樂」還原）；null = 尚未加音樂。
  const [musicOriginal, setMusicOriginal] = useState<{ media: { url: string; kind: 'image' | 'video'; preview: string }; mediaType: MediaType } | null>(null)
  // FB 封面截圖（dev mode：FB 影片一般人看不到 → FB 改發此圖）。
  const [fbCover, setFbCover] = useState<string | null>(null)
  const [alsoStory, setAlsoStory] = useState(false)
  const [showTagging, setShowTagging] = useState(false)
  const [fbPersonTags, setFbPersonTags] = useState<string[]>([])
  const [fbPlace, setFbPlace] = useState('')
  const [igMentions, setIgMentions] = useState<string[]>([])
  const [igLocation, setIgLocation] = useState('')
  const [thLocation, setThLocation] = useState('')
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [manualIgUsername, setManualIgUsername] = useState('')
  // Public FB page picture (no token needed for public pages).
  const pageAvatar = `https://graph.facebook.com/${pageId}/picture?type=square&width=64&height=64`
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

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
  // IG Story 預覽 tab：勾了限動且目標含 IG 才出現（FB 限動停用中，見 fbStoryFlag）。
  const showStoryTab = alsoStory && needsMedia && targets.includes('ig')
  const storyPreviewOn = previewStory && showStoryTab
  const isCarousel = mediaType === 'carousel'
  const maxMedia = isCarousel ? 10 : 1
  const uploading = uploadQueue !== null
  const firstMediaUrl = media[0]?.url ?? ''
  const mediaUrls = media.map(m => m.url)
  // Carousel needs ≥2 items; single types need exactly 1.
  const mediaReady = !needsMedia || (isCarousel ? media.length >= 2 : media.length >= 1)
  const bodiesReady = tailored ? targets.every(t => (perBody[t] ?? '').trim().length > 0) : body.trim().length > 0
  // Platform hard-limit validation (字數/hashtag/媒體) — blocks save on errors.
  const violations = validateItems(targets.map(t => ({
    platform: t, text: eff(t), hashtags: tags, hasMedia: media.length > 0, mediaType, mediaUrls,
  })))
  const blocked = hasBlockingErrors(violations)
  const canSubmit = targets.length > 0 && bodiesReady && !uploading && !blocked && mediaReady
  const notHash = (e: TaggableEntity) => !e.displayName.trim().startsWith('#') && !e.fbUserId?.startsWith('#') && !e.fbPageId?.startsWith('#')
  const fbPeople = taggableEntities.filter(e => notHash(e) && e.type === 'person' && e.enabledPlatforms.includes('fb') && e.confidence === 'ready')
  const fbCandidatePeople = taggableEntities.filter(e => notHash(e) && e.type === 'person' && e.enabledPlatforms.includes('fb') && e.confidence !== 'ready')
  const fbLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('fb') && e.locationId)
  const igPeople = taggableEntities.filter(e => e.type === 'person' && e.enabledPlatforms.includes('ig') && e.igUsername)
  const igLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('ig') && e.locationId)
  const thLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('th') && e.locationId)
  const mentionPlatforms = tailored ? [activePreview] : targets
  const mentionOptions = [
    ...(mentionPlatforms.includes('fb') ? fbPeople.map(entity => ({ entity, platform: 'fb' as DraftTarget })) : []),
    ...(mentionPlatforms.includes('ig') ? igPeople.map(entity => ({ entity, platform: 'ig' as DraftTarget })) : []),
  ]
    .filter(({ entity: e }) => {
      const q = mentionQuery?.query.toLowerCase() ?? ''
      if (!q) return true
      return [e.displayName, e.igUsername, e.fbPageId, e.fbUserId].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })
    .slice(0, 8)
  const selectedEntities = new Map(taggableEntities.map(e => [e.id, e]))
  const selectedTags = [
    ...fbPersonTags.map(id => ({ id, platform: 'fb' as const, label: L('FB 插入姓名', 'FB inserted name') })),
    ...(fbPlace ? [{ id: fbPlace, platform: 'fb' as const, label: L('FB 地點', 'FB place') }] : []),
    ...igMentions.map(id => ({ id, platform: 'ig' as const, label: 'IG @' })),
    ...(igLocation ? [{ id: igLocation, platform: 'ig' as const, label: L('IG 地點', 'IG place') }] : []),
    ...(thLocation ? [{ id: thLocation, platform: 'th' as const, label: L('Threads 地點', 'Threads place') }] : []),
  ].map(x => ({ ...x, entity: selectedEntities.get(x.id) })).filter(x => x.entity)

  function toggle(t: DraftTarget) {
    if (t === 'ig' && !instagramAvailable) {
      setErr(L('請先建立 IG 並連結 Meta 帳號，才能發布 IG。', 'Connect Instagram to Meta before publishing to Instagram.'))
      return
    }
    if (t === 'th' && !threadsAvailable) {
      setErr(L('請先建立 Threads 並連結帳號，才能發布 Threads。', 'Connect a Threads account before publishing to Threads.'))
      return
    }
    setTargets(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t])
  }
  function onMediaTypeChange(m: MediaType) {
    setMediaType(m)
    setMusicOriginal(null)   // 換媒體型態 = 放棄已合成的音樂版本
    setFbCover(null)
    if (m === 'text') setMedia([])
    else if (m !== 'carousel') setMedia(cur => cur.slice(0, 1))   // single types keep 1
  }
  function removeMedia(i: number) { setMedia(cur => cur.filter((_, idx) => idx !== i)); setMusicOriginal(null); setFbCover(null) }

  function onMusicComposed(videoUrl: string) {
    setMusicOriginal({ media: media[0], mediaType })
    setMedia([{ url: videoUrl, kind: 'video', preview: videoUrl }])
    setFbCover(null)   // 影片換了，舊封面作廢
    if (mediaType === 'image') setMediaType('video')   // 圖＋音樂已轉成影片
  }
  function onMusicRestore() {
    if (!musicOriginal) return
    setMedia([musicOriginal.media])
    setMediaType(musicOriginal.mediaType)
    setMusicOriginal(null)
    setFbCover(null)
  }
  function addPasteUrl() {
    const url = pasteUrl.trim()
    if (!url || media.length >= maxMedia) return
    const kind: 'image' | 'video' = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? 'video' : 'image'
    setMedia(cur => [...cur, { url, kind, preview: url }]); setPasteUrl('')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setErr('')
    const uid = auth.currentUser?.uid
    if (!uid) { setErr(L('請重新登入', 'Please re-login')); return }
    const batch = files.slice(0, maxMedia - media.length)
    setUploadQueue({ total: batch.length, done: 0 })
    for (const file of batch) {
      const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image'
      const preview = URL.createObjectURL(file)
      try {
        setUploadPct(0)
        const url = await uploadDraftMedia(uid, file, pct => setUploadPct(pct))
        setMedia(cur => [...cur, { url, kind, preview }]); setUploadPct(100)
      } catch { setErr(L('上傳失敗', 'Upload failed')) }
      setUploadQueue(q => q ? { ...q, done: q.done + 1 } : q)
    }
    setUploadQueue(null); setUploadPct(null)
    if (fileRef.current) fileRef.current.value = ''   // allow re-selecting the same file
  }

  function submit() {
    const perPlatform: CreateDraftInput['generated']['perPlatform'] = {}
    for (const t of targets) {
      // Hashtags go to every platform now. Threads keeps them inline in the body
      // (so the reply-chain split counts them); FB/IG carry them as a field.
      perPlatform[t] = t === 'th'
        ? { body: withTags(eff('th')) }
        : { body: eff(t), ...(tags.length ? { hashtags: tags } : {}), ...(needsMedia && firstMediaUrl ? { mediaUrl: firstMediaUrl } : {}) }
    }
    const canStory = needsMedia && ((FB_STORY_ENABLED && targets.includes('fb')) || targets.includes('ig'))
    const topic = targets.includes('th') && threadsTopic.trim() ? threadsTopic.trim().replace(/^#/, '') : ''
    const tagging = buildTagging()
    onCreate({ target: targets, mediaType, ...(tagging ? { tagging } : {}), generated: {
      perPlatform, ...(needsMedia && firstMediaUrl ? { mediaUrl: firstMediaUrl } : {}),
      ...(isCarousel && mediaUrls.length ? { mediaUrls } : {}),
      ...(canStory && alsoStory ? { alsoStory: true } : {}),
      ...(topic ? { threadsTopicTag: topic } : {}),
      ...(fbCover && targets.includes('fb') && media[0]?.kind === 'video' ? { fbCoverImageUrl: fbCover } : {}),
    } })
  }

  function multiValues(e: React.ChangeEvent<HTMLSelectElement>): string[] {
    return Array.from(e.target.selectedOptions).map(o => o.value).filter(Boolean)
  }

  function uniqueAdd(setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) {
    setter(cur => cur.includes(id) ? cur : [...cur, id])
  }

  function updateMention(value: string, caret: number | null) {
    if (caret === null) { setMentionQuery(null); return }
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/)
    setMentionQuery(m ? { start: caret - m[2].length - 1, query: m[2] } : null)
  }

  function onCaptionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setEditBody(e.target.value)
    updateMention(e.target.value, e.target.selectionStart)
  }

  function onCaptionKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    updateMention(e.currentTarget.value, e.currentTarget.selectionStart)
  }

  function onCaptionClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    updateMention(e.currentTarget.value, e.currentTarget.selectionStart)
  }

  function insertMention(option: { entity: TaggableEntity; platform: DraftTarget }) {
    const { entity, platform } = option
    const el = textRef.current
    const caret = el?.selectionStart ?? editBody.length
    const start = mentionQuery?.start ?? caret
    const label = platform === 'ig' && entity.igUsername
      ? `@${entity.igUsername.replace(/^@/, '')}`
      : entity.displayName
    const next = `${editBody.slice(0, start)}${label} ${editBody.slice(caret)}`
    setEditBody(next)
    if (platform === 'fb') {
      if (entity.type === 'person') uniqueAdd(setFbPersonTags, entity.id)
    } else if (platform === 'ig') {
      uniqueAdd(setIgMentions, entity.id)
    }
    setMentionQuery(null)
    window.setTimeout(() => {
      textRef.current?.focus()
      const pos = start + label.length + 1
      textRef.current?.setSelectionRange(pos, pos)
    }, 0)
  }

  async function addManualIgMention(usernameInput?: string) {
    const username = (usernameInput ?? mentionQuery?.query ?? '').replace(/^@/, '').trim().toLowerCase()
    if (!username || !/^[a-z0-9._]{2,30}$/i.test(username)) return
    try {
      const res = await fetch('/api/taggable-entities', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          type: 'person',
          displayName: `@${username}`,
          igUsername: username,
          enabledPlatforms: ['ig'],
          source: 'manual',
          confidence: 'ready',
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.entity) {
        setErr(d.error ?? L('新增標記名單失敗', 'Failed to add taggable account'))
        return
      }
      onTaggableEntityCreated?.(d.entity as TaggableEntity)
      if (mentionQuery) insertMention({ entity: d.entity as TaggableEntity, platform: 'ig' })
      else uniqueAdd(setIgMentions, (d.entity as TaggableEntity).id)
      setManualIgUsername('')
      setErr('')
    } catch {
      setErr(L('新增標記名單失敗', 'Failed to add taggable account'))
    }
  }

  function removeSelectedTag(platform: DraftTarget, id: string) {
    if (platform === 'fb') {
      setFbPersonTags(cur => cur.filter(x => x !== id))
      if (fbPlace === id) setFbPlace('')
    } else if (platform === 'ig') {
      setIgMentions(cur => cur.filter(x => x !== id))
      if (igLocation === id) setIgLocation('')
    } else if (thLocation === id) setThLocation('')
  }

  function buildTagging(): TaggingSelection | undefined {
    const tagging: TaggingSelection = {}
    if (targets.includes('fb') && (fbPersonTags.length || fbPlace)) {
      tagging.fb = {
        ...(fbPersonTags.length ? { personTags: fbPersonTags } : {}),
        ...(fbPlace ? { place: fbPlace } : {}),
      }
    }
    if (targets.includes('ig') && (igMentions.length || igLocation)) {
      tagging.ig = {
        ...(igMentions.length ? { mentions: igMentions } : {}),
        ...(igLocation ? { location: igLocation } : {}),
      }
    }
    if (targets.includes('th') && thLocation) tagging.th = { location: thLocation }
    return Object.keys(tagging).length ? tagging : undefined
  }

  function SelectMultiple({ label, value, options, onChange }: {
    label: string
    value: string[]
    options: TaggableEntity[]
    onChange: (v: string[]) => void
  }) {
    if (options.length === 0) return null
    return (
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
        <select multiple value={value} onChange={e => onChange(multiValues(e))}
          className="h-20 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
          {options.map(e => <option key={e.id} value={e.id}>{e.displayName}</option>)}
        </select>
      </label>
    )
  }

  const showMedia = needsMedia && media.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-gray-900">✍️ {L('新增內容草稿', 'New content draft')}</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {/* LEFT — form */}
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">{L('發布平台', 'Platforms')}</label>
            <div className="mb-4 flex gap-2">
              {TARGETS.map(t => {
                const disabled = (t.key === 'th' && !threadsAvailable) || (t.key === 'ig' && !instagramAvailable)
                return (
                <button key={t.key} onClick={() => toggle(t.key)} disabled={disabled}
                  title={
                    t.key === 'th' && !threadsAvailable
                      ? L('請先建立 Threads 並連結帳號，才能發布', 'Connect Threads before publishing')
                      : t.key === 'ig' && !instagramAvailable
                        ? L('請先建立 IG 並連結 Meta 帳號，才能發布', 'Connect Instagram to Meta before publishing')
                        : undefined
                  }
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${targets.includes(t.key) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
                  {t.label}
                </button>
                )
              })}
            </div>
            {!instagramAvailable && (
              <p className="-mt-2 mb-2 text-xs text-amber-600">
                {L('Instagram 尚未連結：請先建立 IG 並連結 Meta 帳號，才能發布 IG。', 'Instagram is not connected yet. Connect Instagram to Meta before publishing to Instagram.')}
              </p>
            )}
            {!threadsAvailable && (
              <p className="-mt-2 mb-4 text-xs text-amber-600">
                {L('Threads 尚未連結：請先建立 Threads 並連結帳號，才能發布 Threads。', 'Threads is not connected yet. Connect a Threads account before publishing to Threads.')}
                <a
                  href="/dashboard/settings?from=content-drafts"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 font-semibold underline underline-offset-2 hover:text-amber-700"
                >
                  {L('前往設定頁連結 Threads', 'Open settings to connect Threads')}
                </a>
              </p>
            )}

            <label className="mb-1 block text-sm font-semibold text-gray-700">{L('媒體型態', 'Media type')}</label>
            <select value={mediaType} onChange={e => onMediaTypeChange(e.target.value as MediaType)}
              className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800">
              <option value="text">{L('純文字', 'Text')}</option>
              <option value="image">{L('單圖', 'Image')}</option>
              <option value="carousel">{L('輪播（多圖/影片，≤10）', 'Carousel (≤10)')}</option>
              <option value="video">{L('影片', 'Video')}</option>
              <option value="reels">Reels</option>
            </select>

            {needsMedia && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-semibold text-gray-700">
                  {L('影音素材', 'Media')}
                  {isCarousel && <span className="ml-1 text-xs font-normal text-gray-400">{media.length}/10（{L('至少 2', 'min 2')}）</span>}
                  {uploadQueue && <span className="ml-2 text-xs font-bold text-blue-600">⏳ {L('上傳中', 'Uploading')} {Math.min(uploadQueue.done + 1, uploadQueue.total)}/{uploadQueue.total}</span>}
                </label>
                {/* Thumbnails of added media (with remove). */}
                {media.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {media.map((m, i) => (
                      <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                        {m.kind === 'video'
                          ? <video src={m.preview} className="h-full w-full object-cover" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={m.preview} alt="" className="h-full w-full object-cover" />}
                        <button onClick={() => removeMedia(i)} className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/60 text-[10px] text-white">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {media.length < maxMedia && (<>
                  <input ref={fileRef} type="file" accept="image/*,video/*" multiple={isCarousel} onChange={onFile} className="hidden" />
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:border-blue-300">
                    🖼️ {isCarousel ? L('新增相片 / 影片（可多選）', 'Add photos / videos') : L('新增相片 / 影片', 'Add photo / video')}
                  </button>
                  {uploading && <p className="mt-1 text-xs text-blue-600">{L('上傳中', 'Uploading')} {Math.round(uploadPct ?? 0)}%</p>}
                  <span className="mt-2 flex gap-1">
                    <input value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPasteUrl() } }}
                      placeholder={L('或貼上公開媒體 URL', 'or paste a public media URL')}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700" />
                    <button onClick={addPasteUrl} className="rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-600">{L('加入', 'Add')}</button>
                  </span>
                </>)}
                {/* 音樂（Slice 1）：單圖/單影片可加音檔，合成結果直接取代草稿媒體。
                    輪播不支援（Meta 輪播是多張相片，無單一影片可掛音軌）。 */}
                {!isCarousel && media.length === 1 && (
                  <AudioComposer idToken={idToken} pageId={pageId}
                    media={musicOriginal ? null : { url: media[0].url, kind: media[0].kind }}
                    hasMusic={!!musicOriginal}
                    onComposed={onMusicComposed} onRestore={onMusicRestore} />
                )}
                {/* FB 封面截圖：dev mode 期間 API 發的 FB 影片一般人看不到 →
                    截封面圖讓 FB 發圖片、IG/Threads 照發影片。Live 後不顯示。 */}
                {!FB_VIDEO_ENABLED && targets.includes('fb') && !isCarousel && media.length === 1 && media[0].kind === 'video' && (
                  <FbCoverPicker pageId={pageId} videoUrl={media[0].url} cover={fbCover} onCover={setFbCover} />
                )}
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
            <div className="relative">
              <textarea ref={textRef} value={editBody} onChange={onCaptionChange} onKeyUp={onCaptionKeyUp} onClick={onCaptionClick} rows={5}
                placeholder={L('輸入貼文文案，或按「AI 生成文案」…', 'Write a caption, or use "AI caption"…')}
                className="w-full resize-y rounded-lg border border-gray-200 p-3 text-sm text-gray-800" />
              {mentionQuery && (
                <div className="absolute left-3 top-11 z-20 max-h-48 w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                  {mentionOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      {activePreview === 'fb'
                        ? L('沒有可用 FB 名單；可先同步歷史貼文中的已知姓名/粉專。', 'No FB list available; sync known names/pages from historical posts first.')
                        : L('沒有符合的 @帳號', 'No matching @account')}
                    </div>
                  ) : mentionOptions.map(({ entity: e, platform }) => (
                    <button key={`${platform}-${e.id}`} type="button" onMouseDown={ev => { ev.preventDefault(); insertMention({ entity: e, platform }) }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50">
                      <span className="truncate font-semibold text-gray-700">{platform === 'ig' && e.igUsername ? `@${e.igUsername}` : e.displayName}</span>
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">{platform.toUpperCase()} · {e.type}</span>
                    </button>
                  ))}
                  {mentionQuery.query && mentionPlatforms.includes('ig') && /^[a-z0-9._]{2,30}$/i.test(mentionQuery.query) && !igPeople.some(e => e.igUsername?.toLowerCase() === mentionQuery.query.toLowerCase()) && (
                    <button type="button" onMouseDown={ev => { ev.preventDefault(); addManualIgMention() }}
                      className="flex w-full items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-left text-blue-700 hover:bg-blue-50">
                      <span className="truncate font-semibold">{L(`新增 @${mentionQuery.query} 到 IG 名單`, `Add @${mentionQuery.query} to IG list`)}</span>
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600">IG</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            {selectedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedTags.map(({ id, platform, label, entity }) => (
                  <button key={`${platform}-${label}-${id}`} type="button" onClick={() => removeSelectedTag(platform, id)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    {label}: {entity!.displayName} ×
                  </button>
                ))}
              </div>
            )}
            {thWillSplit && <p className="mt-1 text-xs text-purple-600">🧵 {L(`Threads 超過 500 字，將自動切成 ${thSegs.length} 則（1 主貼 + ${thSegs.length - 1} 則留言）。`, `Over 500 chars — Threads auto-splits into ${thSegs.length} (1 main + ${thSegs.length - 1} replies).`)}</p>}

            {targets.length > 0 && (
              <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder={L('Hashtags（套用所有平台，空白分隔；IG ≤30）', 'Hashtags (all platforms, space-separated; IG ≤30)')}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            )}
            {targets.includes('th') && (
              <input value={threadsTopic} onChange={e => setThreadsTopic(e.target.value)} placeholder={L('Threads 主題標籤（選填，單一，用於分類/被搜尋）', 'Threads topic tag (optional, single)')}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            )}

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setShowTagging(v => !v)}
                  className="text-sm font-semibold text-gray-700">
                  {showTagging ? '▾' : '▸'} {L('進階標記', 'Advanced tagging')}
                </button>
                <button type="button" onClick={onSyncTaggableEntities}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-blue-600 disabled:opacity-40"
                  disabled={!onSyncTaggableEntities}>
                  {L('同步名單', 'Sync list')}
                </button>
              </div>
              {showTagging && (
                <div className="mt-3 space-y-3">
                  {taggableEntities.length === 0 && <p className="text-xs text-gray-400">{L('尚無可用標記名單。可先同步歷史貼文，或之後手動建立名單。', 'No taggable entities yet. Sync historical posts first or add manually later.')}</p>}
                  {targets.includes('fb') && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                      <p className="text-xs font-bold text-gray-700">Facebook</p>
                      {fbPeople.length === 0 && fbLocations.length === 0 && (
                        <p className="text-xs text-amber-600">
                          {L('目前沒有 FB 可用名單。因 Meta 限制，FB 個人只支援插入姓名，不支援 clickable link 或真正 tag。', 'No Facebook list yet. Due to Meta limits, FB people are inserted as names only and do not become clickable links or true tags.')}
                        </p>
                      )}
                      {fbCandidatePeople.length > 0 && (
                        <p className="text-xs text-gray-500">
                          {L(`已找到 ${fbCandidatePeople.length} 位留言互動候選人；確認後可加入插入姓名名單。`, `${fbCandidatePeople.length} commenter candidates found; after verification they can be used for name insertion.`)}
                        </p>
                      )}
                      <SelectMultiple label={L('插入個人姓名', 'Insert names')} value={fbPersonTags} options={fbPeople} onChange={setFbPersonTags} />
                      <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-500">
                        {L('因 Meta Graph API 限制，FB 個人只會把姓名插入文案，不會連到 profile，也不會形成真正 tag；目前只有 FB 地點會送 Meta 標記參數。', 'Due to Meta Graph API limits, Facebook people are inserted as plain names only; they will not link to profiles or become true tags. Currently only FB locations are sent as Meta tag parameters.')}
                      </p>
                      {fbLocations.length > 0 && (
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-gray-500">{L('地點', 'Location')}</span>
                          <select value={fbPlace} onChange={e => setFbPlace(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                            <option value="">{L('不標記地點', 'No location')}</option>
                            {fbLocations.map(e => <option key={e.id} value={e.id}>{e.displayName}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                  {targets.includes('ig') && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                      <p className="text-xs font-bold text-gray-700">Instagram</p>
                      <SelectMultiple label={L('@帳號', '@accounts')} value={igMentions} options={igPeople} onChange={setIgMentions} />
                      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-2">
                        <p className="mb-2 text-xs font-semibold text-gray-500">{L('手動加入 IG 帳號', 'Manually add IG account')}</p>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <input value={manualIgUsername} onChange={e => setManualIgUsername(e.target.value)}
                            placeholder={L('@username', '@username')}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700" />
                          <button type="button" onClick={() => addManualIgMention(manualIgUsername)}
                            className="rounded-md border border-blue-200 bg-white px-2 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50">
                            {L('加入', 'Add')}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {L('IG 發布會把 @username 放進 caption；Instagram 不需要先取得 FB User ID。', 'Instagram publishing adds @username to the caption; it does not require a Facebook User ID.')}
                        </p>
                      </div>
                      {igLocations.length > 0 && (
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-gray-500">{L('地點', 'Location')}</span>
                          <select value={igLocation} onChange={e => setIgLocation(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                            <option value="">{L('不標記地點', 'No location')}</option>
                            {igLocations.map(e => <option key={e.id} value={e.id}>{e.displayName}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                  {targets.includes('th') && thLocations.length > 0 && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                      <p className="text-xs font-bold text-gray-700">Threads</p>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-gray-500">{L('地點', 'Location')}</span>
                        <select value={thLocation} onChange={e => setThLocation(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                          <option value="">{L('不標記地點', 'No location')}</option>
                          {thLocations.map(e => <option key={e.id} value={e.id}>{e.displayName}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Story is time-sensitive → opt-in separately, not a media type.
                Needs media + FB/IG (Threads has no stories). FB Story is gated
                off while the Meta app is in dev mode (viewers see black). */}
            {needsMedia && (targets.includes('fb') || targets.includes('ig')) && (() => {
              const storyTargets = targets.filter(t => (t === 'fb' && FB_STORY_ENABLED) || t === 'ig')
              const storyDisabled = storyTargets.length === 0
              return (
                <label className={`mt-3 flex items-start gap-2 rounded-lg border border-gray-200 p-3 ${storyDisabled ? 'opacity-70' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={alsoStory && !storyDisabled} disabled={storyDisabled} onChange={e => setAlsoStory(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-700">📸 {L('同時發佈限動 Story', 'Also post as Story')}</span>
                    <span className="block text-xs text-gray-400">
                      {L(
                        '把這則媒體同時發成 24 小時限動；FB 圖片限動會自動轉成 9:16 短影片，輪播只取第一張。',
                        'Also publish this media as a 24h Story; Facebook image Stories are converted to a 9:16 short video, and carousel uses the first item only.',
                      )}
                    </span>
                    {!FB_STORY_ENABLED && targets.includes('fb') && (
                      <span className="mt-1 block text-xs font-semibold text-amber-600">
                        {L(
                          'FB 限動暫停發布：Meta App 尚在開發模式，一般觀眾會看到黑畫面，待審核上線後開放。',
                          'FB Stories are paused: the Meta app is still in Development mode, so regular viewers see a black screen. They will reopen after App Review.',
                        )}
                      </span>
                    )}
                    {alsoStory && !storyDisabled && (
                      <span className="mt-1 block text-xs font-semibold text-pink-600">
                        {L('限動將發佈到：', 'Story will post to: ')}
                        {storyTargets.map(t => t === 'ig' ? 'Instagram' : 'Facebook').join(L('、', ', '))}
                      </span>
                    )}
                  </span>
                </label>
              )
            })()}
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
                      <button key={t} onClick={() => { setPreviewPlat(t); setPreviewStory(false) }}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${activePreview === t && !storyPreviewOn ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500'}`}>
                        {PLAT_TAB[t]}
                      </button>
                    ))}
                    {showStoryTab && (
                      <button onClick={() => setPreviewStory(true)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${storyPreviewOn ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500'}`}>
                        📸 {L('限動', 'Story')}
                      </button>
                    )}
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
                  {storyPreviewOn
                    ? <StoryPreview mediaItems={media.map(m => ({ url: m.preview, kind: m.kind }))} pageName={pageName} pageAvatar={pageAvatar} />
                    : <PostPreview platform={activePreview} body={eff(activePreview)}
                        mediaItems={activePreview === 'fb' && fbCover && media[0]?.kind === 'video'
                          ? [{ url: fbCover, kind: 'image' as const }]   // FB 將發封面圖（dev mode）
                          : media.map(m => ({ url: m.preview, kind: m.kind }))}
                        hashtags={tags} showMedia={!!showMedia} pageName={pageName} pageAvatar={pageAvatar} />}
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
