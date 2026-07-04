'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { MessageStats } from '@/components/dashboard/MessageStats'
import type { MessagesData } from '@/components/dashboard/MessageStats'
import { AiSidekick } from '@/components/ads/AiSidekick'
import { ProfileMenu } from '@/components/ProfileMenu'
import { NotificationBell } from '@/components/NotificationBell'

interface PageInfo { pageId: string; pageName: string }

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
  const [userName, setUserName] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)

  // Auth + load managed/viewer pages, default to the last-selected page.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/auth/login'); return }
      const token = await user.getIdToken()
      setIdToken(token)
      setUserName(user.displayName ?? user.email ?? '')
      try {
        const res = await fetch('/api/pages', { headers: { Authorization: `Bearer ${token}` } })
        const body = res.ok ? await res.json() : { pages: [] }
        const list: PageInfo[] = body.pages ?? []
        setPages(list)
        setIsAdmin(body.isAdmin ?? false)
        setIsOwner(body.isOwner ?? false)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
        const active = list.find(p => p.pageId === saved) ?? list[0]
        setSelectedPageId(active?.pageId ?? '')
      } catch {
        setError(L('無法載入粉專清單', 'Failed to load pages'))
      }
    })
    return unsub
  }, [router, L])

  async function handleSignOut() { await signOut(auth); router.replace('/auth/login') }

  const load = useCallback(async (token: string, pageId: string) => {
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/messages?pageId=${encodeURIComponent(pageId)}`, { headers: { Authorization: `Bearer ${token}` } })
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
    if (idToken && selectedPageId) load(idToken, selectedPageId)
  }, [idToken, selectedPageId, load])

  function onPageChange(pageId: string) {
    setSelectedPageId(pageId)
    localStorage.setItem('selectedPageId', pageId)
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
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
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <ProfileMenu userName={userName} role={isAdmin ? 'admin' : 'viewer'} isOwner={isOwner} onSignOut={handleSignOut} />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">{L('IG 與 FB 私訊的成效統計（唯讀）。', 'Read-only analytics for your IG & FB direct messages.')}</p>
          <button
            onClick={() => setSkOpen(true)}
            className="rounded-lg bg-[var(--ad-blue,#3B6FD4)] px-3 py-1.5 text-sm font-semibold text-white"
          >
            {L('問 AI', 'Ask AI')}
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400">{L('讀取中…', 'Loading…')}</p>}
        {error && !loading && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
            {error}
            <p className="mt-1 text-xs text-amber-500">{L('若剛加上私訊權限，請先到「設定」重新連接粉專授權。', 'If you just added messaging permissions, please reconnect your Page in Settings.')}</p>
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
