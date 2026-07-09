'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import type { ContentDraft, DraftTarget, DraftStatus, GeneratedContent } from '@/lib/content/draftTypes'
import { validateItems } from '@/lib/publish/validateDraft'

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

export function DraftCard({ draft, onTransition, onEdit, onPublishAll, onDuplicate, onDelete, onSchedule, onUnschedule, busy, publishingPlatform, canPublish = true, unavailableTargets = [] }: {
  draft: ContentDraft
  onTransition: (id: string, status: DraftStatus) => void
  onEdit: (id: string, generated: GeneratedContent) => void
  onPublishAll: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onSchedule: (id: string, atMs: number) => void
  onUnschedule: (id: string) => void
  busy: boolean
  publishingPlatform?: DraftTarget | null   // platform currently being published for THIS draft
  canPublish?: boolean
  unavailableTargets?: DraftTarget[]
}) {
  const { L } = useLang()
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

  const rec = draft.generated.recommendation
  // Option A: once ANY platform is published the draft is LOCKED — published
  // posts can't be unpublished, so no revert/edit; only補發 remaining or 複製.
  // Pre-publish warnings (e.g. FB mixed image+video carousel) surfaced on the card.
  const cardViolations = validateItems(draft.target.map(t => ({
    platform: t, text: draft.generated.perPlatform[t]?.body ?? '', hashtags: draft.generated.perPlatform[t]?.hashtags ?? [],
    hasMedia: !!(draft.generated.mediaUrl || draft.generated.mediaUrls?.length), mediaType: draft.mediaType, mediaUrls: draft.generated.mediaUrls,
  }))).filter(v => v.code === 'fb_mixed_carousel' || v.code === 'fb_video_carousel')
  const anyPublished = draft.target.some(t => draft.publishResults?.[t]?.postId)
  const allPublished = draft.target.length > 0 && draft.target.every(t => draft.publishResults?.[t]?.postId)
  const publishError = firstPublishError(draft)
  const retryableFailure = draft.status === 'failed' || (!!publishError && !anyPublished)
  const locked = anyPublished
  const canEdit = draft.status === 'draft' && !locked
  const unavailable = draft.target.filter(t => unavailableTargets.includes(t) && !draft.publishResults?.[t]?.postId)

  function saveEdit() {
    const perPlatform = { ...draft.generated.perPlatform }
    for (const t of draft.target) perPlatform[t] = { ...perPlatform[t], body: bodies[t] ?? '' }
    onEdit(draft.id, { ...draft.generated, perPlatform })
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
                <textarea value={bodies[t] ?? ''} onChange={e => setBodies(b => ({ ...b, [t]: e.target.value }))}
                  className="w-full resize-y rounded-md border border-gray-200 p-2 text-sm text-gray-800" rows={3} />
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
