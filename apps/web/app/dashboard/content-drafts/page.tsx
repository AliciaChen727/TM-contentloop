'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { DraftCard } from '@/components/content/DraftCard'
import { DraftComposer } from '@/components/content/DraftComposer'
import type { ContentDraft, DraftStatus, GeneratedContent, CreateDraftInput } from '@/lib/content/draftTypes'

interface PageInfo { pageId: string; pageName: string }
type Tab = 'draft' | 'approved' | 'published' | 'other'
const TAB_MATCH: Record<Tab, DraftStatus[]> = {
  draft: ['draft'], approved: ['approved', 'scheduled', 'publishing', 'processing'],
  published: ['published'], other: ['rejected', 'expired', 'failed'],
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

  const patch = useCallback(async (id: string, payload: { status?: DraftStatus; generated?: GeneratedContent }) => {
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

  const shown = drafts.filter(d => TAB_MATCH[tab].includes(d.status))
  const count = (t: Tab) => drafts.filter(d => TAB_MATCH[t].includes(d.status)).length
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
        <p className="mb-4 text-sm text-gray-500">{L('Agent 生成的內容會先存為草稿，經你核准後才發布（Threads 授權後可先發）。', 'Agent-generated content lands here as drafts; nothing publishes until you approve.')}</p>
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
                <DraftCard key={d.id} draft={d} busy={busy}
                  onTransition={(id, status) => patch(id, { status })}
                  onEdit={(id, generated) => patch(id, { generated })} />
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
