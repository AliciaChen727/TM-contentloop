'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

// One-time Threads connect (separate OAuth from FB/IG) + manual sync. After
// connecting, the daily cron auto-syncs Threads too. Per page.
export function ThreadsConnectCard({ pageId, idToken }: { pageId: string; idToken: string }) {
  const { L } = useLang()
  const [connected, setConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const d = e.data as { type?: string; status?: string; reason?: string }
      if (d?.type !== 'threads-result') return
      if (d.status === 'connected') { setConnected(true); setMsg({ kind: 'ok', text: L('✅ 已連接 Threads，可以按「同步」抓資料了。', '✅ Threads connected — click "Sync" to fetch data.') }) }
      else setMsg({ kind: 'err', text: L(`連接失敗：${d.reason ?? '未知錯誤'}`, `Connection failed: ${d.reason ?? 'unknown error'}`) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function connect() {
    if (!idToken || !pageId) return
    const url = `/api/auth/threads/authorize?idToken=${encodeURIComponent(idToken)}&pageId=${encodeURIComponent(pageId)}`
    const popup = window.open(url, 'threads-oauth', 'width=600,height=760')
    if (!popup) window.location.href = url
  }

  async function sync() {
    setSyncing(true); setMsg(null)
    try {
      const res = await fetch('/api/threads/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ pageId }),
      })
      const d = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: d.error ?? L('同步失敗', 'Sync failed') }); return }
      setConnected(true)
      setMsg({ kind: 'ok', text: L(`✅ 同步完成，抓到 ${d.postCount ?? 0} 則 Threads 貼文。`, `✅ Sync complete — fetched ${d.postCount ?? 0} Threads posts.`) })
    } finally { setSyncing(false) }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: 'white' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🧵 {L('Threads 串接（內容成效）', 'Threads Integration (content)')}</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>{L('Threads 是獨立授權（跟 FB/IG 不同），連接一次後每日會自動更新貼文成效。Threads 沒有廣告，只看內容。', 'Threads uses a separate authorization (different from FB/IG). Connect once and post performance updates daily. Threads has no ads — content only.')}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={connect}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: '#111', color: 'white', cursor: 'pointer' }}>
          {connected ? L('重新連接 Threads', 'Reconnect Threads') : L('連接 Threads', 'Connect Threads')}
        </button>
        <button onClick={sync} disabled={syncing}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: syncing ? 'default' : 'pointer' }}>
          {syncing ? L('⋯ 同步中', '⋯ Syncing') : L('↻ 立即同步', '↻ Sync now')}
        </button>
      </div>
      {msg && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.kind === 'ok' ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
