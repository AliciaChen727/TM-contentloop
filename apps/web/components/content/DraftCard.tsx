'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import type { ContentDraft, DraftTarget, DraftStatus, GeneratedContent } from '@/lib/content/draftTypes'

const PLAT_LABEL: Record<DraftTarget, string> = { fb: 'Facebook', ig: 'Instagram', th: 'Threads' }
const PLAT_COLOR: Record<DraftTarget, string> = { fb: '#1877F2', ig: '#C13584', th: '#000000' }

// Threads has a hard 500-char cap; surface it inline so editing stays compliant.
const TH_LIMIT = 500
const IG_HASHTAG_LIMIT = 30

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

export function DraftCard({ draft, onTransition, onEdit, busy }: {
  draft: ContentDraft
  onTransition: (id: string, status: DraftStatus) => void
  onEdit: (id: string, generated: GeneratedContent) => void
  busy: boolean
}) {
  const { L } = useLang()
  const [editing, setEditing] = useState(false)
  const [bodies, setBodies] = useState<Record<string, string>>(
    Object.fromEntries(draft.target.map(t => [t, draft.generated.perPlatform[t]?.body ?? ''])),
  )

  const rec = draft.generated.recommendation
  const canEdit = draft.status === 'draft'

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
        <div className="ml-auto"><StatusPill status={draft.status} /></div>
      </div>

      {draft.generated.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.generated.mediaUrl} alt="" className="mb-3 max-h-64 w-full rounded-lg object-contain" style={{ background: '#F9FAFB' }} />
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

      {/* Actions — human-in-the-loop gate. Publish itself is S4 (needs Meta scopes). */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        {draft.status === 'draft' && !editing && (<>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'approved')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">✓ {L('核准', 'Approve')}</button>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'rejected')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">{L('拒絕', 'Reject')}</button>
          <button disabled={busy} onClick={() => setEditing(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">✎ {L('編輯', 'Edit')}</button>
        </>)}
        {editing && (<>
          <button disabled={busy} onClick={saveEdit} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{L('儲存', 'Save')}</button>
          <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600">{L('取消', 'Cancel')}</button>
        </>)}
        {draft.status === 'approved' && (<>
          <span className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">{L('待發布（Meta 授權後開放）', 'Awaiting publish (needs Meta scope)')}</span>
          <button disabled={busy} onClick={() => onTransition(draft.id, 'draft')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">↩ {L('收回核准', 'Unapprove')}</button>
        </>)}
        {(draft.status === 'rejected' || draft.status === 'expired' || draft.status === 'failed') && (
          <button disabled={busy} onClick={() => onTransition(draft.id, 'draft')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">↩ {L('復原為草稿', 'Restore to draft')}</button>
        )}
      </div>
    </div>
  )
}
