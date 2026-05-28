'use client'

// Tiny client-side helper for /api/debug/scopes. Visit:
//   /debug/scopes?pageId=235543696463178
// (or omit pageId to fall back to the last selectedPageId from localStorage).
// Renders the raw JSON so it's easy to copy/paste back for diagnosis.

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

export default function DebugScopesPage() {
  const [out, setOut] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string>('')

  useEffect(() => {
    const url = typeof window !== 'undefined' ? new URL(window.location.href) : null
    const pid = url?.searchParams.get('pageId') || (typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') ?? '' : '')
    setPageId(pid)
    if (!pid) { setErr('No pageId in URL and none in localStorage.selectedPageId'); return }
    const unsub = onAuthStateChanged(auth, async u => {
      if (!u) { setErr('Not signed in — open the dashboard first.'); return }
      try {
        const t = await u.getIdToken()
        const r = await fetch(`/api/debug/scopes?pageId=${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${t}` } })
        const json = await r.json()
        setOut(json)
        if (!r.ok) setErr(`HTTP ${r.status}`)
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    })
    return () => unsub()
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 1100 }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Debug: page token scopes</h1>
      <div style={{ marginBottom: 12, color: '#555' }}>pageId: <b>{pageId || '(none)'}</b></div>
      {err && <div style={{ color: '#b00', marginBottom: 12 }}>⚠ {err}</div>}
      <pre style={{ background: '#0b1020', color: '#d7e3ff', padding: 16, borderRadius: 8, fontSize: 12, lineHeight: 1.5, overflowX: 'auto' }}>
        {out ? JSON.stringify(out, null, 2) : 'Loading…'}
      </pre>
    </div>
  )
}
