'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

// Phase 2 — in-app notification center bell + dropdown panel.
// See docs/phase-2-notification-center.md.

interface NotificationItem {
  id: string
  type: string
  pageId: string
  pageName: string
  title: string
  body: string
  advice: string
  actionPrompt: string | null
  deepLink: string
  read: boolean
  createdAt: number | null
}

const TYPE_ICON: Record<string, string> = {
  ad_anomaly: '⚠️',
  report_ready: '📊',
  invite: '👤',
  system: '🔔',
}

function relativeTime(ms: number | null): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const load = useCallback(async () => {
    const u = auth.currentUser
    if (!u) return
    setLoading(true)
    try {
      const token = await u.getIdToken()
      const r = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const j = await r.json()
        setItems(j.items ?? [])
        setUnread(j.unreadCount ?? 0)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  // Initial load (once authenticated) + reload whenever the panel opens.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { if (u) load() })
    return () => unsub()
  }, [load])

  useEffect(() => { if (open) load() }, [open, load])

  // Close on outside click.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function markRead(body: { id?: string; all?: boolean }) {
    const u = auth.currentUser
    if (!u) return
    const token = await u.getIdToken()
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function onItemClick(n: NotificationItem) {
    setOpen(false)
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnread((c) => Math.max(0, c - 1))
      markRead({ id: n.id }).catch(() => {})
    }
    router.push(n.deepLink || '/dashboard')
  }

  async function onMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    setUnread(0)
    await markRead({ all: true }).catch(() => {})
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="通知"
        style={{
          position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 4, color: '#6B7280',
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16,
            padding: '0 4px', borderRadius: 8, background: '#EF4444', color: 'white',
            fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0, zIndex: 100,
          background: 'white', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          border: '1px solid #E5E7EB', width: 360, maxHeight: 440, overflowY: 'auto',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid #F3F4F6', position: 'sticky', top: 0, background: 'white',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>通知</span>
            {items.some((x) => !x.read) && (
              <button onClick={onMarkAll} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6366F1',
              }}>全部標為已讀</button>
            )}
          </div>

          {loading && items.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>載入中⋯⋯</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>目前沒有通知 🎉</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => onItemClick(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '12px 16px', borderBottom: '1px solid #F3F4F6',
                  background: n.read ? 'white' : '#F5F7FF',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F9FAFB')}
                onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? 'white' : '#F5F7FF')}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {!n.read && <span style={{ marginTop: 6, width: 7, height: 7, borderRadius: '50%', background: '#6366F1', flexShrink: 0 }} />}
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{n.title}</div>
                    {n.advice && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, whiteSpace: 'pre-line' }}>{n.advice}</div>}
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      {n.pageName}{n.pageName && n.createdAt ? ' · ' : ''}{relativeTime(n.createdAt)}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
