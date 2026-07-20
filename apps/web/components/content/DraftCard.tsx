'use client'

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import type { ContentDraft, DraftTarget, DraftStatus, GeneratedContent, TaggingSelection } from '@/lib/content/draftTypes'
import { validateItems } from '@/lib/publish/validateDraft'
import { FB_STORY_ENABLED } from '@/lib/content/fbStoryFlag'
import type { TaggableEntity } from '@/lib/tagging/types'

const PLAT_LABEL: Record<DraftTarget, string> = { fb: 'Facebook', ig: 'Instagram', th: 'Threads' }
const PLAT_COLOR: Record<DraftTarget, string> = { fb: '#1877F2', ig: '#C13584', th: '#000000' }

// Threads has a hard 500-char cap; surface it inline so editing stays compliant.
const TH_LIMIT = 500
const IG_HASHTAG_LIMIT = 30

// Only surface an error for a platform that did NOT publish. Once a postId
// exists (success), any earlier error is stale and must not be shown.
function firstPublishError(d: ContentDraft): string | undefined {
  for (const t of d.target) {
    const r = d.publishResults?.[t]
    if (r?.error && !r.postId) return r.error
  }
  return undefined
}

function StatusPill({ status }: { status: DraftStatus }) {
  const { L } = useLang()
  const map: Record<DraftStatus, { text: string; bg: string; fg: string }> = {
    draft:      { text: L('待審', 'Draft'), bg: '#FEF3C7', fg: '#92400E' },
    approved:   { text: L('已核准', 'Approved'), bg: '#DBEAFE', fg: '#1E40AF' },
    scheduled:  { text: L('已排程', 'Scheduled'), bg: '#E0E7FF', fg: '#3730A3' },
    publishing: { text: L('發布中', 'Publishing'), bg: '#E0E7FF', fg: '#3730A3' },
    processing: { text: L('處理中', 'Processing'), bg: '#E0E7FF', fg: '#3730A3' },
    published:  { text: L('已發布', 'Published'), bg: '#D1FAE5', fg: '#065F46' },
    failed:     { text: L('失敗', 'Failed'), bg: '#FEE2E2', fg: '#991B1B' },
    rejected:   { text: L('已拒絕', 'Rejected'), bg: '#F3F4F6', fg: '#6B7280' },
    expired:    { text: L('已逾時', 'Expired'), bg: '#F3F4F6', fg: '#6B7280' },
  }
  const s = map[status]
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: s.bg, color: s.fg }}>{s.text}</span>
}

export function DraftCard({ draft, onTransition, onEdit, onPublishAll, onRepublishFbStory, onDuplicate, onDelete, onSchedule, onUnschedule, busy, publishingPlatform, canPublish = true, isOwner = false, unavailableTargets = [], taggableEntities = [] }: {
  draft: ContentDraft
  onTransition: (id: string, status: DraftStatus) => void
  onEdit: (id: string, generated: GeneratedContent, tagging?: TaggingSelection) => void
  onPublishAll: (id: string) => void
  onRepublishFbStory?: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onSchedule: (id: string, atMs: number) => void
  onUnschedule: (id: string) => void
  busy: boolean
  publishingPlatform?: DraftTarget | null   // platform currently being published for THIS draft
  canPublish?: boolean
  isOwner?: boolean   // FB Story repair 僅 owner（dev mode 黑畫面驗證/上線後補發用）
  unavailableTargets?: DraftTarget[]
  taggableEntities?: TaggableEntity[]
}) {
  const { L, lang } = useLang()
  const fmtTime = (ms?: number) => ms ? new Date(ms).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const [editing, setEditing] = useState(false)
  // Schedule: split into date / hour / minute for a custom 5-min-step picker
  const [schedDate, setSchedDate] = useState('')   // 'YYYY-MM-DD'
  const [schedHour, setSchedHour] = useState('09') // '00'–'23'
  const [schedMinute, setSchedMinute] = useState('00') // '00','05','10'…
  const schedMs = schedDate
    ? new Date(`${schedDate}T${schedHour}:${schedMinute}:00`).getTime()
    : NaN
  const [bodies, setBodies] = useState<Record<string, string>>(
    Object.fromEntries(draft.target.map(t => [t, draft.generated.perPlatform[t]?.body ?? ''])),
  )
  const [fbPersonTags, setFbPersonTags] = useState<string[]>(draft.tagging?.fb?.personTags ?? [])
  const [fbPlace, setFbPlace] = useState(draft.tagging?.fb?.place ?? '')
  const [igMentions, setIgMentions] = useState<string[]>(draft.tagging?.ig?.mentions ?? [])
  const [igLocation, setIgLocation] = useState(draft.tagging?.ig?.location ?? '')
  const [thLocation, setThLocation] = useState(draft.tagging?.th?.location ?? '')
  const [mentionQuery, setMentionQuery] = useState<{ target: DraftTarget; start: number; query: string } | null>(null)
  const editRefs = useRef<Partial<Record<DraftTarget, HTMLTextAreaElement | null>>>({})

  const rec = draft.generated.recommendation
  // Option A: once ANY platform is published the draft is LOCKED — published
  // posts can't be unpublished, so no revert/edit; only補發 remaining or 複製.
  // Pre-publish warnings (e.g. FB mixed image+video carousel) surfaced on the card.
  const cardViolations = validateItems(draft.target.map(t => ({
    platform: t, text: draft.generated.perPlatform[t]?.body ?? '', hashtags: draft.generated.perPlatform[t]?.hashtags ?? [],
    hasMedia: !!(draft.generated.mediaUrl || draft.generated.mediaUrls?.length), mediaType: draft.mediaType, mediaUrls: draft.generated.mediaUrls,
  })), { lang }).filter(v => v.code === 'fb_mixed_carousel' || v.code === 'fb_video_carousel')
  const anyPublished = draft.target.some(t => draft.publishResults?.[t]?.postId)
  const allPublished = draft.target.length > 0 && draft.target.every(t => draft.publishResults?.[t]?.postId)
  const publishError = firstPublishError(draft)
  const retryableFailure = draft.status === 'failed' || (!!publishError && !anyPublished)
  const locked = anyPublished
  const canEdit = draft.status === 'draft' && !locked
  // FB Story 停用期間（dev mode 黑畫面）整顆隱藏；重開 flag 後自動回來。
  const canRepairFbStory = FB_STORY_ENABLED
    && canPublish
    && isOwner
    && !editing
    && !!draft.generated.alsoStory
    && !!draft.publishResults?.fb?.postId
    && !!(draft.generated.mediaUrl || draft.generated.mediaUrls?.[0])
  const unavailable = draft.target.filter(t => unavailableTargets.includes(t) && !draft.publishResults?.[t]?.postId)
  const notHash = (e: TaggableEntity) => !e.displayName.trim().startsWith('#') && !e.fbUserId?.startsWith('#') && !e.fbPageId?.startsWith('#')
  const fbPeople = taggableEntities.filter(e => notHash(e) && e.type === 'person' && e.enabledPlatforms.includes('fb') && e.confidence === 'ready')
  const fbLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('fb') && e.locationId)
  const igPeople = taggableEntities.filter(e => e.type === 'person' && e.enabledPlatforms.includes('ig') && e.igUsername)
  const igLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('ig') && e.locationId)
  const thLocations = taggableEntities.filter(e => e.type === 'location' && e.enabledPlatforms.includes('th') && e.locationId)

  function multiValues(e: ChangeEvent<HTMLSelectElement>): string[] {
    return Array.from(e.target.selectedOptions).map(o => o.value)
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

  function uniqueAdd(setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) {
    setter(cur => cur.includes(id) ? cur : [...cur, id])
  }

  function updateMention(target: DraftTarget, value: string, caret: number | null) {
    if (caret === null || (target !== 'fb' && target !== 'ig')) { setMentionQuery(null); return }
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/)
    setMentionQuery(m ? { target, start: caret - m[2].length - 1, query: m[2] } : null)
  }

  function mentionOptions(target: DraftTarget): TaggableEntity[] {
    const options = target === 'fb' ? fbPeople : target === 'ig' ? igPeople : []
    const q = mentionQuery?.target === target ? mentionQuery.query.toLowerCase() : ''
    return options
      .filter(e => {
        if (!q) return true
        return [e.displayName, e.igUsername, e.fbPageId, e.fbUserId].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
      })
      .slice(0, 8)
  }

  function onBodyChange(target: DraftTarget, value: string, caret: number | null) {
    setBodies(b => ({ ...b, [target]: value }))
    updateMention(target, value, caret)
  }

  function insertMention(target: DraftTarget, entity: TaggableEntity) {
    const current = bodies[target] ?? ''
    const el = editRefs.current[target]
    const caret = el?.selectionStart ?? current.length
    const start = mentionQuery?.target === target ? mentionQuery.start : caret
    const label = target === 'ig' && entity.igUsername
      ? `@${entity.igUsername.replace(/^@/, '')}`
      : entity.displayName
    const next = `${current.slice(0, start)}${label} ${current.slice(caret)}`
    setBodies(b => ({ ...b, [target]: next }))
    if (target === 'fb') {
      if (entity.type === 'person') uniqueAdd(setFbPersonTags, entity.id)
    } else if (target === 'ig') {
      uniqueAdd(setIgMentions, entity.id)
    }
    setMentionQuery(null)
    window.setTimeout(() => {
      const ref = editRefs.current[target]
      ref?.focus()
      const pos = start + label.length + 1
      ref?.setSelectionRange(pos, pos)
    }, 0)
  }

  function buildTagging(): TaggingSelection {
    const tagging: TaggingSelection = {}
    if (draft.target.includes('fb') && (fbPersonTags.length || fbPlace)) {
      tagging.fb = {
        ...(fbPersonTags.length ? { personTags: fbPersonTags } : {}),
        ...(fbPlace ? { place: fbPlace } : {}),
      }
    }
    if (draft.target.includes('ig') && (igMentions.length || igLocation)) {
      tagging.ig = {
        ...(igMentions.length ? { mentions: igMentions } : {}),
        ...(igLocation ? { location: igLocation } : {}),
      }
    }
    if (draft.target.includes('th') && thLocation) tagging.th = { location: thLocation }
    return tagging
  }

  function saveEdit() {
    const perPlatform = { ...draft.generated.perPlatform }
    for (const t of draft.target) perPlatform[t] = { ...perPlatform[t], body: bodies[t] ?? '' }
    onEdit(draft.id, { ...draft.generated, perPlatform }, buildTagging())
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {draft.target.map(t => (
          <span key={t} className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ background: PLAT_COLOR[t] }}>{PLAT_LABEL[t]}</span>
        ))}
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{draft.mediaType}</span>
        {draft.generated.alsoStory && <span className="rounded-md bg-pink-100 px-2 py-0.5 text-xs font-semibold text-pink-700">📸 {L('＋限動', '+Story')}</span>}
        <div className="ml-auto">
          {anyPublished
            ? <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: allPublished ? '#D1FAE5' : '#DBEAFE', color: allPublished ? '#065F46' : '#1E40AF' }}>{allPublished ? L('已發布', 'Published') : L('部分發布', 'Partly published')}</span>
            : <StatusPill status={retryableFailure ? 'failed' : draft.status} />}
        </div>
      </div>

      {/* Carousel (mediaUrls, ≥2) → horizontal strip; else single image/video. */}
      {(draft.generated.mediaUrls?.length ?? 0) > 1 ? (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {draft.generated.mediaUrls!.map((u, i) => (
            /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)
              ? <video key={i} src={u} controls className="h-40 w-40 flex-shrink-0 rounded-lg object-cover" style={{ background: '#F9FAFB' }} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img key={i} src={u} alt="" className="h-40 w-40 flex-shrink-0 rounded-lg object-cover" style={{ background: '#F9FAFB' }} />
          ))}
        </div>
      ) : draft.generated.mediaUrl && (
        (draft.mediaType === 'video' || draft.mediaType === 'reels' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(draft.generated.mediaUrl))
          ? <video src={draft.generated.mediaUrl} controls className="mb-3 max-h-64 w-full rounded-lg" style={{ background: '#F9FAFB' }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={draft.generated.mediaUrl} alt="" className="mb-3 max-h-64 w-full rounded-lg object-contain" style={{ background: '#F9FAFB' }} />
      )}

      <div className="space-y-2">
        {draft.target.map(t => {
          const over = t === 'th' && (bodies[t]?.length ?? 0) > TH_LIMIT
          return (
            <div key={t} className="rounded-lg bg-gray-50 p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color: PLAT_COLOR[t] }}>{PLAT_LABEL[t]}</span>
                {t === 'th' && <span className={`text-xs font-semibold ${over ? 'text-red-600' : 'text-gray-400'}`}>{bodies[t]?.length ?? 0}/{TH_LIMIT}</span>}
              </div>
              {editing && canEdit ? (
                <div className="relative">
                  <textarea
                    ref={el => { editRefs.current[t] = el }}
                    value={bodies[t] ?? ''}
                    onChange={e => onBodyChange(t, e.target.value, e.target.selectionStart)}
                    onKeyUp={e => updateMention(t, e.currentTarget.value, e.currentTarget.selectionStart)}
                    onClick={e => updateMention(t, e.currentTarget.value, e.currentTarget.selectionStart)}
                    className="w-full resize-y rounded-md border border-gray-200 p-2 text-sm text-gray-800"
                    rows={3}
                  />
                  {mentionQuery?.target === t && (t === 'fb' || t === 'ig') && (
                    <div className="absolute left-2 top-10 z-20 max-h-48 w-[min(22rem,calc(100%-1rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                      {mentionOptions(t).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">
                          {t === 'fb'
                            ? L('沒有符合的 FB 個人名單；FB 只支援插入姓名。', 'No matching Facebook people list; Facebook supports name insertion only.')
                            : L('沒有符合的 IG @帳號', 'No matching IG @account')}
                        </div>
                      ) : mentionOptions(t).map(e => (
                        <button key={`${t}-${e.id}`} type="button" onMouseDown={ev => { ev.preventDefault(); insertMention(t, e) }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50">
                          <span className="truncate font-semibold text-gray-700">{t === 'ig' && e.igUsername ? `@${e.igUsername}` : e.displayName}</span>
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">{t.toUpperCase()} · {e.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-gray-800">{draft.generated.perPlatform[t]?.body || <span className="text-gray-400">（無文案）</span>}</p>
              )}
              {(draft.generated.perPlatform[t]?.hashtags?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-blue-600">{draft.generated.perPlatform[t]!.hashtags!.slice(0, IG_HASHTAG_LIMIT).map(h => `#${h}`).join(' ')}</p>
              )}
            </div>
          )
        })}
      </div>

      {editing && canEdit && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-sm font-semibold text-gray-700">{L('進階標記', 'Advanced tagging')}</p>
          <div className="space-y-3">
            {draft.target.includes('fb') && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                <p className="text-xs font-bold text-gray-700">Facebook</p>
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
            {draft.target.includes('ig') && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                <p className="text-xs font-bold text-gray-700">Instagram</p>
                <SelectMultiple label={L('@帳號', '@accounts')} value={igMentions} options={igPeople} onChange={setIgMentions} />
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
            {draft.target.includes('th') && thLocations.length > 0 && (
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
        </div>
      )}

      {rec && (
        <p className="mt-2 text-xs text-gray-500">📱 {L('裝置建議', 'Device rec')}：<span className="font-semibold">{rec.format}</span> — {rec.why}</p>
      )}
      {draft.publishResult?.error && <p className="mt-2 text-xs text-red-600">⚠ {draft.publishResult.error}</p>}
      {draft.publishResult?.postId && <p className="mt-2 text-xs text-green-700">✓ {L('已發布 ID', 'Post ID')}: {draft.publishResult.postId}</p>}
      {unavailable.includes('th') && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {L('請先建立 Threads 並連結帳號，才能發布 Threads。', 'Connect a Threads account before publishing to Threads.')}
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
      {unavailable.includes('ig') && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {L('請先建立 IG 並連結 Meta 帳號，才能發布 IG。', 'Connect Instagram to Meta before publishing to Instagram.')}
        </p>
      )}

      {/* Pre-publish warnings (FB mixed carousel etc.) — hide once fully published. */}
      {!allPublished && cardViolations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {cardViolations.map((v, i) => (
            <li key={i} className={`flex items-start gap-1 text-xs ${v.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
              <span>{v.severity === 'error' ? '⛔' : '⚠️'}</span>{v.message}
            </li>
          ))}
        </ul>
      )}

      {/* Actions — human-in-the-loop gate. Publish itself is S4 (needs Meta scopes). */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        {canPublish && draft.status === 'draft' && !locked && !editing && (<>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'approved')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">✓ {L('核准', 'Approve')}</button>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'rejected')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">{L('拒絕', 'Reject')}</button>
        </>)}
        {draft.status === 'draft' && !locked && !editing && (
          <button disabled={busy} onClick={() => setEditing(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">✎ {L('編輯', 'Edit')}</button>
        )}
        {editing && (<>
          <button disabled={busy} onClick={saveEdit} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{L('儲存', 'Save')}</button>
          <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600">{L('取消', 'Cancel')}</button>
        </>)}
        {/* Publish/published block — also renders when LOCKED (some platform out). */}
        {(draft.status === 'approved' || draft.status === 'published' || locked) && !editing && !retryableFailure && (<>
          {/* Already-published platforms → link (+限動 if a Story was posted). */}
          {draft.target.filter(t => draft.publishResults?.[t]?.postId).map(t => (
            <a key={t} href={draft.publishResults![t]!.permalink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">✓ {PLAT_LABEL[t]} {L('已發布', 'published')}{draft.publishResults![t]!.storyId ? L('＋限動', '+Story') : ''} ↗</a>
          ))}
          {canRepairFbStory && onRepublishFbStory && (
            <button
              disabled={busy}
              onClick={() => onRepublishFbStory(draft.id)}
              title={L('只補發 Facebook 限動，不重發主貼或其他平台。', 'Only repost the Facebook Story; main posts and other platforms are unchanged.')}
              className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs font-semibold text-pink-700 disabled:opacity-50"
            >
              📸 {L('補發 FB 限動', 'Repost FB Story')}
            </button>
          )}
          {/* One-click publish to all remaining platforms at once. */}
          {(() => {
            const remaining = draft.target.filter(t => !draft.publishResults?.[t]?.postId && !unavailableTargets.includes(t))
            if (remaining.length === 0 || !canPublish) return null
            return (
              <button disabled={busy} onClick={() => onPublishAll(draft.id)}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-70">
                {publishingPlatform
                  ? `⏳ ${L('發布', 'Publishing')} ${PLAT_LABEL[publishingPlatform]}${L('中…', '…')}`
                  : `🚀 ${L('一鍵發布', 'Publish all')}（${remaining.map(t => PLAT_LABEL[t]).join('、')}）`}
              </button>
            )
          })()}
          {publishError && <span className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">⚠ {publishError}</span>}
          {/* Unapprove only while not yet published anywhere. */}
          {canPublish && draft.status === 'approved' && !locked && <button disabled={busy} onClick={() => onTransition(draft.id, 'draft')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">↩ {L('收回核准', 'Unapprove')}</button>}
        </>)}
        {/* Duplicate — the way to re-post a published draft (a new editable draft). */}
        {locked && <button disabled={busy} onClick={() => onDuplicate(draft.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">📄 {L('複製為新草稿', 'Duplicate')}</button>}
        {/* Schedule (S5) — any approved draft can auto-publish later (all platforms). */}
        {canPublish && draft.status === 'approved' && !locked && !retryableFailure && unavailable.length === 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {/* Date */}
            <input
              type="date"
              value={schedDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setSchedDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700"
            />
            {/* Hour */}
            <select
              value={schedHour}
              onChange={e => setSchedHour(e.target.value)}
              className="rounded-lg border border-gray-200 px-1 py-1 text-xs text-gray-700"
            >
              {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">:</span>
            {/* Minute — 5-min steps only */}
            <select
              value={schedMinute}
              onChange={e => setSchedMinute(e.target.value)}
              className="rounded-lg border border-gray-200 px-1 py-1 text-xs text-gray-700"
            >
              {['00','05','10','15','20','25','30','35','40','45','50','55'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              disabled={busy || !schedDate || isNaN(schedMs)}
              onClick={() => onSchedule(draft.id, schedMs)}
              className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-600 disabled:opacity-50"
            >⏰ {L('排程', 'Schedule')}</button>
          </span>
        )}
        {canPublish && draft.status === 'scheduled' && unavailable.length === 0 && (<>
          <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">⏰ {L('已排程', 'Scheduled')}：{fmtTime(draft.schedule?.at)}</span>
          <button disabled={busy} onClick={() => onPublishAll(draft.id)} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-70">{publishingPlatform ? `⏳ ${L('發布中…', 'Publishing…')}` : `🚀 ${L('立即發布', 'Publish now')}`}</button>
          <button disabled={busy} onClick={() => onUnschedule(draft.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">✕ {L('取消排程', 'Cancel')}</button>
        </>)}
        {(draft.status === 'rejected' || draft.status === 'expired') && (
          <button disabled={busy} onClick={() => onTransition(draft.id, 'draft')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">↩ {L('復原為草稿', 'Restore to draft')}</button>
        )}
        {canPublish && retryableFailure && (<>
          {publishError && <span className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">⚠ {publishError}</span>}
          <button disabled={busy} onClick={() => onTransition(draft.id, 'approved')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">🔄 {L('重試發布', 'Retry publish')}</button>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'draft')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">↩ {L('復原為草稿', 'Restore to draft')}</button>
        </>)}
        {!editing && canPublish && (
          <button disabled={busy} onClick={() => onDelete(draft.id)}
            className="ml-auto flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m2 0v9.5A1.5 1.5 0 0112.5 17h-5A1.5 1.5 0 016 15.5V6M8.5 9v5M11.5 9v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {L('刪除', 'Delete')}
          </button>
        )}
      </div>
    </div>
  )
}
