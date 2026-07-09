'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { DraftCard } from '@/components/content/DraftCard'
import { DraftComposer } from '@/components/content/DraftComposer'
import type { ContentDraft, DraftStatus, DraftTarget, GeneratedContent, CreateDraftInput } from '@/lib/content/draftTypes'

interface PageInfo { pageId: string; pageName: string }
type Tab = 'draft' | 'approved' | 'published' | 'other'
const TAB_MATCH: Record<Tab, DraftStatus[]> = {
  draft: ['draft'], approved: ['approved', 'scheduled', 'publishing', 'processing'],
  published: ['published'], other: ['rejected', 'expired', 'failed'],
}

// Which tab a draft belongs to. A multi-platform draft where some platforms are
// published (e.g. Threads done, FB/IG waiting for App Review) counts as
// "published" even though its overall status is still `approved`.
function tabOf(d: ContentDraft): Tab {
  const anyPublished = Object.values(d.publishResults ?? {}).some(r => r?.postId)
  const hasUnpublishedError = Object.values(d.publishResults ?? {}).some(r => r?.error && !r.postId)
  if (d.status === 'published' || anyPublished) return 'published'
  if (hasUnpublishedError) return 'other'
  if (TAB_MATCH.draft.includes(d.status)) return 'draft'
  if (TAB_MATCH.other.includes(d.status)) return 'other'
  return 'approved'
}

export default function ContentDraftsPage() {
  const router = useRouter()
  const { L } = useLang()
  const [idToken, setIdToken] = useState('')
  const [pages, setPages] = useState<PageInfo[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('draft')
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState<{ id: string; platform: DraftTarget } | null>(null)
  const [killSwitch, setKillSwitch] = useState(false)
  const [quiet, setQuiet] = useState<{ start: number; end: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/auth/login'); return }
      const token = await user.getIdToken()
      setIdToken(token)
      try {
        const res = await fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } })
        const body = res.ok ? await res.json() : { pages: [] }
        const list: PageInfo[] = body.pages ?? []
        setPages(list)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
        const nextPageId = (list.find(p => p.pageId === saved) ?? list[0])?.pageId ?? ''
        setSelectedPageId(nextPageId)
        if (!nextPageId) {
          setDrafts([])
          setError(L('找不到可管理的粉專，請先連接或確認權限。', 'No manageable pages found. Connect a page or check your access.'))
          setLoading(false)
        }
      } catch {
        setDrafts([])
        setError(L('無法載入粉專清單', 'Failed to load pages'))
        setLoading(false)
      }
    })
    return unsub
  }, [router, L])

  const load = useCallback(async (token: string, pageId: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/content-drafts?pageId=${encodeURIComponent(pageId)}&limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? L('讀取失敗', 'Failed to load')); setDrafts([]); return }
      setDrafts((d.drafts ?? []) as ContentDraft[])
    } catch { setError(L('讀取失敗', 'Failed to load')) } finally { setLoading(false) }
  }, [L])

  // Silent refresh — same fetch but WITHOUT setLoading(true), so the UI
  // doesn't flash to "Loading…". Used for background refetches on tab focus.
  const silentLoad = useCallback(async (token: string, pageId: string) => {
    try {
      const res = await fetch(`/api/content-drafts?pageId=${encodeURIComponent(pageId)}&limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      const d = await res.json()
      if (res.ok) setDrafts((d.drafts ?? []) as ContentDraft[])
    } catch { /* silent — don't show error on background refresh */ }
  }, [])

  useEffect(() => { if (idToken && selectedPageId) load(idToken, selectedPageId) }, [idToken, selectedPageId, load])

  // Refresh on window focus / tab visibility change only (no polling).
  // Firebase cron handles scheduled publishing server-side, so client
  // polling is unnecessary and was causing page flash every 30s.
  useEffect(() => {
    if (!idToken || !selectedPageId) return
    const refresh = () => { if (document.visibilityState === 'visible' && !busy) silentLoad(idToken, selectedPageId) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [idToken, selectedPageId, busy, silentLoad])

  // Load per-page automation settings (Kill Switch + quiet hours).
  useEffect(() => {
    if (!idToken || !selectedPageId) return
    fetch(`/api/content-drafts/automation?pageId=${encodeURIComponent(selectedPageId)}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.settings) { setKillSwitch(!!d.settings.killSwitch); setQuiet(d.settings.quietHours ?? null) } })
      .catch(() => {})
  }, [idToken, selectedPageId])

  const saveAutomation = useCallback(async (patch: { killSwitch?: boolean; quietHours?: { start: number; end: number } | null }) => {
    setKillSwitch(v => patch.killSwitch ?? v)
    if (patch.quietHours !== undefined) setQuiet(patch.quietHours)
    await fetch('/api/content-drafts/automation', {
      method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: selectedPageId, ...patch }),
    }).catch(() => {})
  }, [idToken, selectedPageId])

  const create = useCallback(async (input: Omit<CreateDraftInput, 'pageId'>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/content-drafts', {
        method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId, ...input }),
      })
      if (res.ok) { setComposing(false); await load(idToken, selectedPageId) }
      else { const d = await res.json(); setError(d.error ?? L('建立失敗', 'Create failed')) }
    } finally { setBusy(false) }
  }, [idToken, selectedPageId, load, L])

  const patch = useCallback(async (id: string, payload: { status?: DraftStatus; generated?: GeneratedContent; scheduleAt?: number; unschedule?: boolean }) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/content-drafts/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId, ...payload }),
      })
      if (res.ok) await load(idToken, selectedPageId)
      else { const d = await res.json(); setError(d.error ?? L('更新失敗', 'Update failed')) }
    } finally { setBusy(false) }
  }, [idToken, selectedPageId, load, L])

  // One-click publish: sequentially publish every not-yet-published target platform.
  const publishAll = useCallback(async (id: string) => {
    const draft = drafts.find(d => d.id === id)
    if (!draft) return
    const todo = draft.target.filter(t => !draft.publishResults?.[t]?.postId)
    if (todo.length === 0) return
    const names = todo.map(t => t === 'th' ? 'Threads' : t === 'fb' ? 'Facebook' : 'Instagram')
    if (!window.confirm(L(`確定一鍵發布到 ${names.join('、')}？這會真的貼出貼文。`, `Publish to ${names.join(', ')}? This posts for real.`))) return
    setBusy(true); setError('')
    try {
      for (const platform of todo) {
        setPublishing({ id, platform })
        try {
          const res = await fetch(`/api/content-drafts/${id}/publish`, {
            method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId: selectedPageId, platform }),
          })
          const d = await res.json().catch(() => ({}))
          const nm = platform === 'th' ? 'Threads' : platform === 'fb' ? 'Facebook' : 'Instagram'
          if (!res.ok) setError(prev => `${prev ? prev + '；' : ''}${nm}：${d.error ?? L('發布失敗', 'failed')}`)
          else if (d.storyNote) setError(prev => `${prev ? prev + '；' : ''}${nm} ${L('主貼已發，但', 'posted, but ')}${d.storyNote}`)
        } catch {
          const nm = platform === 'th' ? 'Threads' : platform === 'fb' ? 'Facebook' : 'Instagram'
          setError(prev => `${prev ? prev + '；' : ''}${nm}：${L('逾時/失敗', 'timeout/failed')}`)
        }
      }
      await load(idToken, selectedPageId)
    } finally { setBusy(false); setPublishing(null) }
  }, [drafts, idToken, selectedPageId, load, L])

  // Duplicate a (usually published) draft into a fresh editable draft.
  const duplicate = useCallback(async (id: string) => {
    const d = drafts.find(x => x.id === id)
    if (!d) return
    setBusy(true)
    try {
      const res = await fetch('/api/content-drafts', {
        method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId, target: d.target, mediaType: d.mediaType, generated: d.generated }),
      })
      if (res.ok) { setTab('draft'); await load(idToken, selectedPageId) }
      else { const e = await res.json(); setError(e.error ?? L('複製失敗', 'Duplicate failed')) }
    } finally { setBusy(false) }
  }, [drafts, idToken, selectedPageId, load, L])

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(L('確定刪除這則草稿？此動作無法復原。', 'Delete this draft? This cannot be undone.'))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/content-drafts/${id}?pageId=${encodeURIComponent(selectedPageId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? L('刪除失敗', 'Delete failed')) }
      await load(idToken, selectedPageId)
    } finally { setBusy(false) }
  }, [idToken, selectedPageId, load, L])

  const shown = drafts.filter(d => tabOf(d) === tab)
  const count = (t: Tab) => drafts.filter(d => tabOf(d) === t).length
  const tabBtn = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500 hover:text-gray-800'}`}>
      {label} {count(t) > 0 && <span className="opacity-70">({count(t)})</span>}
    </button>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/80 px-6 py-3 backdrop-blur">
        <button onClick={() => router.push('/dashboard')} className="text-sm font-semibold text-gray-600 transition-colors hover:text-gray-800">← {L('返回儀表板', 'Dashboard')}</button>
        <span className="text-gray-200">|</span>
        <h1 className="text-lg font-bold text-gray-900">✍️ {L('AI 草稿發布', 'AI Draft Publishing')}</h1>
        {pages.length > 0 && (
          <select value={selectedPageId} onChange={e => setSelectedPageId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700">
            {pages.map(p => <option key={p.pageId} value={p.pageId}>{p.pageName}</option>)}
          </select>
        )}
        <button onClick={() => setComposing(true)} className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">＋ {L('新草稿', 'New draft')}</button>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="mb-3 text-sm text-gray-500">{L('Agent 生成的內容會先存為草稿，經你核准後才發布。', 'Agent-generated content lands here as drafts; nothing publishes until you approve.')}</p>

        {/* Automation controls (S5a): Kill Switch + quiet hours for scheduled publishing. */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">⚙️ {L('排程自動化', 'Automation')}</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={killSwitch} onChange={e => saveAutomation({ killSwitch: e.target.checked })} className="h-4 w-4 accent-red-600" />
            <span className={killSwitch ? 'font-bold text-red-600' : 'text-gray-600'}>{killSwitch ? L('🛑 已暫停所有排程發布', '🛑 All scheduled publishing paused') : L('Kill Switch（暫停排程發布）', 'Kill Switch')}</span>
          </label>
          <span className="flex items-center gap-1 text-sm text-gray-600">
            <span>{L('靜默時段', 'Quiet hours')}</span>
            {quiet ? (<>
              {/* Editable start/end hour — adjust anytime. */}
              <select value={quiet.start} onChange={e => saveAutomation({ quietHours: { start: Number(e.target.value), end: quiet.end } })}
                className="rounded border border-gray-200 px-1 py-0.5 text-xs">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span>–</span>
              <select value={quiet.end} onChange={e => saveAutomation({ quietHours: { start: quiet.start, end: Number(e.target.value) } })}
                className="rounded border border-gray-200 px-1 py-0.5 text-xs">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="text-xs">{L('不發', 'no-post')}</span>
              <button onClick={() => saveAutomation({ quietHours: null })} className="ml-1 text-xs text-gray-400 hover:text-gray-600">✕</button>
            </>) : (
              <button onClick={() => saveAutomation({ quietHours: { start: 22, end: 8 } })} className="text-xs font-semibold text-indigo-600">＋ {L('設定不發時段', 'Set quiet hours')}</button>
            )}
          </span>
          <span className="text-xs text-gray-400">{L('（此時段內到期的排程會延到時段外才發）', '(due posts defer until outside this window)')}</span>
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          {tabBtn('draft', L('待審', 'Draft'))}
          {tabBtn('approved', L('已核准', 'Approved'))}
          {tabBtn('published', L('已發布', 'Published'))}
          {tabBtn('other', L('其他', 'Other'))}
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {loading ? <p className="text-sm text-gray-400">{L('讀取中…', 'Loading…')}</p>
          : shown.length === 0 ? <p className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">{L('此分頁沒有草稿。', 'No drafts in this tab.')}</p>
          : (
            <div className="space-y-4">
              {shown.map(d => (
                <DraftCard key={d.id} draft={d} busy={busy} publishingPlatform={publishing?.id === d.id ? publishing.platform : null}
                  onTransition={(id, status) => patch(id, { status })}
                  onEdit={(id, generated) => patch(id, { generated })}
                  onPublishAll={publishAll} onDuplicate={duplicate} onDelete={remove}
                  onSchedule={(id, atMs) => patch(id, { scheduleAt: atMs })}
                  onUnschedule={(id) => patch(id, { unschedule: true })} />
              ))}
            </div>
          )}
      </div>

      {composing && selectedPageId && (
        <DraftComposer pageId={selectedPageId} pageName={pages.find(p => p.pageId === selectedPageId)?.pageName} idToken={idToken} busy={busy} onClose={() => setComposing(false)} onCreate={create} />
      )}
    </main>
  )
}
