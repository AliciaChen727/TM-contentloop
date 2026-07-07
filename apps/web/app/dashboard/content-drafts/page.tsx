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
  if (d.status === 'published' || anyPublished) return 'published'
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
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [killSwitch, setKillSwitch] = useState(false)
  const [quiet, setQuiet] = useState<{ start: number; end: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/auth/login'); return }
      const token = await user.getIdToken()
      setIdToken(token)
      try {
        const res = await fetch('/api/pages?ownOnly=1', { headers: { Authorization: `Bearer ${token}` } })
        const body = res.ok ? await res.json() : { pages: [] }
        const list: PageInfo[] = body.pages ?? []
        setPages(list)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
        setSelectedPageId((list.find(p => p.pageId === saved) ?? list[0])?.pageId ?? '')
      } catch { setError(L('無法載入粉專清單', 'Failed to load pages')) }
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

  useEffect(() => { if (idToken && selectedPageId) load(idToken, selectedPageId) }, [idToken, selectedPageId, load])

  // Auto-refresh so cron/scheduled publishes reflect without a manual reload:
  // refetch on window focus + poll every 30s while the tab is visible. Skips
  // while an action is in-flight (busy) to avoid racing with it.
  useEffect(() => {
    if (!idToken || !selectedPageId) return
    const refresh = () => { if (document.visibilityState === 'visible' && !busy) load(idToken, selectedPageId) }
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const timer = setInterval(refresh, 30000)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); clearInterval(timer) }
  }, [idToken, selectedPageId, busy, load])

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

  const publish = useCallback(async (id: string, platform: DraftTarget) => {
    const label = platform === 'th' ? 'Threads' : platform
    if (!window.confirm(L(`確定要立即發布到 ${label}？這會真的貼出貼文。`, `Publish to ${label} now? This posts for real.`))) return
    setBusy(true); setPublishingId(id); setError('')
    try {
      const res = await fetch(`/api/content-drafts/${id}/publish`, {
        method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId, platform }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? L('發布失敗', 'Publish failed')) }
      await load(idToken, selectedPageId)
    } catch {
      // Never fail silently: a timeout / 5xx (e.g. carousel with many videos) lands here.
      setError(L('發布失敗或逾時（含多支影片的輪播較慢，請稍候重試或減少影片數）。若主貼已發出，請到 Threads 檢查。', 'Publish failed or timed out (carousels with many videos are slow — retry or use fewer videos).'))
    } finally { setBusy(false); setPublishingId(null) }
  }, [idToken, selectedPageId, load, L])

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
        <p className="mb-3 text-sm text-gray-500">{L('Agent 生成的內容會先存為草稿，經你核准後才發布（Threads 授權後可先發）。', 'Agent-generated content lands here as drafts; nothing publishes until you approve.')}</p>

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
              <span className="font-semibold">{String(quiet.start).padStart(2, '0')}:00–{String(quiet.end).padStart(2, '0')}:00</span>
              <button onClick={() => saveAutomation({ quietHours: null })} className="ml-1 text-xs text-gray-400 hover:text-gray-600">✕</button>
            </>) : (
              <button onClick={() => saveAutomation({ quietHours: { start: 22, end: 8 } })} className="text-xs font-semibold text-indigo-600">＋ {L('設 22:00–08:00 不發', 'Set 22:00–08:00')}</button>
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
                <DraftCard key={d.id} draft={d} busy={busy} publishing={publishingId === d.id}
                  onTransition={(id, status) => patch(id, { status })}
                  onEdit={(id, generated) => patch(id, { generated })}
                  onPublish={publish} onDelete={remove}
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
