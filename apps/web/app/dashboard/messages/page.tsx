'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { MessageStats } from '@/components/dashboard/MessageStats'
import type { MessagesData } from '@/components/dashboard/MessageStats'
import { TopQuestions } from '@/components/dashboard/TopQuestions'
import type { TopIntent } from '@/components/dashboard/TopQuestions'
import { AiSidekick } from '@/components/ads/AiSidekick'

interface PageInfo { pageId: string; pageName: string }
type Range = '30d' | '90d' | 'all' | 'custom'

export default function MessagesPage() {
  const router = useRouter()
  const { L } = useLang()
  const [idToken, setIdToken] = useState('')
  const [pages, setPages] = useState<PageInfo[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [data, setData] = useState<MessagesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [skOpen, setSkOpen] = useState(false)
  const [range, setRange] = useState<Range>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [topIntents, setTopIntents] = useState<TopIntent[]>([])
  const [classifying, setClassifying] = useState(false)
  const [topComputedAt, setTopComputedAt] = useState<number | null>(null)

  // Auth + load managed/viewer pages, default to the last-selected page.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/auth/login'); return }
      const token = await user.getIdToken()
      setIdToken(token)
      try {
        const res = await fetch('/api/pages', { headers: { Authorization: `Bearer ${token}` } })
        const body = res.ok ? await res.json() : { pages: [] }
        const list: PageInfo[] = body.pages ?? []
        setPages(list)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
        const active = list.find(p => p.pageId === saved) ?? list[0]
        setSelectedPageId(active?.pageId ?? '')
      } catch {
        setError(L('無法載入粉專清單', 'Failed to load pages'))
      }
    })
    return unsub
  }, [router, L])

  const load = useCallback(async (token: string, pageId: string, r: Range, start: string, end: string) => {
    setLoading(true); setError(''); setData(null)
    try {
      const params = new URLSearchParams({ pageId, range: r })
      if (r === 'custom') {
        if (start) params.set('since', start)
        if (end) params.set('until', end)
      }
      const res = await fetch(`/api/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? L('讀取失敗', 'Failed to load')); return }
      setData(d as MessagesData)
    } catch {
      setError(L('讀取失敗', 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [L])

  useEffect(() => {
    if (!idToken || !selectedPageId) return
    // For custom range, wait until both dates are picked.
    if (range === 'custom' && (!customStart || !customEnd)) return
    load(idToken, selectedPageId, range, customStart, customEnd)
  }, [idToken, selectedPageId, range, customStart, customEnd, load])

  // Classify inbound messages into "Top questions" (server-side; text never leaves
  // the server). Runs after the page/range settles; classification is cached so
  // repeat runs are cheap. Custom range maps to the nearest preset window server-side.
  const classify = useCallback(async (token: string, pageId: string, r: Range, force = false) => {
    setClassifying(true)
    if (!force) { setTopIntents([]); setTopComputedAt(null) }
    try {
      const res = await fetch('/api/messages/classify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, range: r === 'custom' ? 'all' : r, lang: L('zh', 'en'), force }),
      })
      if (!res.ok) return
      const d = await res.json()
      setTopIntents((d.topIntents ?? []) as TopIntent[])
      setTopComputedAt(d.computedAt ?? null)
    } catch { /* Top-questions is best-effort; stats still render */ }
    finally { setClassifying(false) }
  }, [L])

  useEffect(() => {
    if (!idToken || !selectedPageId) return
    if (range === 'custom' && (!customStart || !customEnd)) return
    classify(idToken, selectedPageId, range)
  }, [idToken, selectedPageId, range, customStart, customEnd, classify])

  function onPageChange(pageId: string) {
    setSelectedPageId(pageId)
    localStorage.setItem('selectedPageId', pageId)
  }

  const rangeBtn = (r: Range, label: string) => (
    <button
      onClick={() => setRange(r)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        range === r ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/80 px-6 py-3 backdrop-blur">
        <button onClick={() => router.push('/dashboard')} className="text-sm text-gray-400 transition-colors hover:text-gray-700">
          ← {L('返回儀表板', 'Dashboard')}
        </button>
        <span className="text-gray-200">|</span>
        <h1 className="text-lg font-bold text-gray-900">{L('私訊分析', 'Messages')}</h1>
        {pages.length > 0 && (
          <select
            value={selectedPageId}
            onChange={e => onPageChange(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"
          >
            {pages.map(p => <option key={p.pageId} value={p.pageId}>{p.pageName}</option>)}
          </select>
        )}
        <button
          onClick={() => router.push('/dashboard/messages/faq')}
          className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          🤖 {L('AI 自動回覆設定', 'AI auto-reply')}
        </button>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Date-range filter (mirrors the main dashboard). */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-gray-400">{L('資料區間', 'Range')}</span>
          {rangeBtn('30d', L('30 日', '30d'))}
          {rangeBtn('90d', L('90 日', '90d'))}
          {rangeBtn('all', L('全部', 'All'))}
          {rangeBtn('custom', L('自訂', 'Custom'))}
          {range === 'custom' && (
            <span className="flex items-center gap-1">
              <input type="date" value={customStart} max={customEnd || undefined}
                onChange={e => setCustomStart(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-700" />
              <span className="text-gray-400">–</span>
              <input type="date" value={customEnd} min={customStart || undefined}
                onChange={e => setCustomEnd(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-700" />
            </span>
          )}
          <button
            onClick={() => setSkOpen(true)}
            className="ml-auto rounded-lg bg-[var(--ad-blue,#3B6FD4)] px-3 py-1.5 text-sm font-semibold text-white"
          >
            {L('問 AI', 'Ask AI')}
          </button>
        </div>

        <p className="mb-6 text-sm text-gray-500">{L('IG 與 FB 私訊的成效統計（唯讀）。', 'Read-only analytics for your IG & FB direct messages.')}</p>

        {loading && <p className="text-sm text-gray-400">{L('讀取中…', 'Loading…')}</p>}

        {/* Reconnect prompt — the stored token predates the messaging scopes, so
            the user must re-run OAuth (/auth/connect) and grant IG/FB message
            permissions before any DM data can be read. */}
        {!loading && (error || (data && (!data.byPlatform.IG.available || !data.byPlatform.FB.available))) && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">
              {error
                ? L('讀不到私訊資料', 'Cannot read message data')
                : L('部分平台的私訊讀不到', 'Some platforms are unavailable')}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              {L('要看私訊統計，需要「重新連接粉專」並在授權畫面勾選「管理 Instagram / Facebook 訊息」權限（第一次加這個功能時必做一次）。',
                 'To see message analytics, reconnect your Page and grant the "manage Instagram / Facebook messages" permissions on the authorization screen (required once when first enabling this feature).')}
            </p>
            <button
              onClick={() => router.push('/auth/connect')}
              className="mt-3 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
            >
              {L('重新連接粉專授權', 'Reconnect Page')}
            </button>
          </div>
        )}

        {data && !loading && (
          <div className="mb-6">
            <TopQuestions
              intents={topIntents}
              loading={classifying}
              computedAt={topComputedAt}
              onRefresh={() => classify(idToken, selectedPageId, range, true)}
            />
          </div>
        )}
        {data && !loading && <MessageStats data={data} />}
      </div>

      <AiSidekick
        open={skOpen}
        onClose={() => setSkOpen(false)}
        contextPage="messages"
        pageId={selectedPageId || undefined}
      />
    </main>
  )
}
