'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Self-service GA4 connection wizard (Phase B). Lets a page admin connect their
 * own GA4 without going through the ContentLoop owner:
 *   1. copy our service-account email  2. add it as Viewer in GA4
 *   3. paste GA4 Property ID + save    4. test connection
 */
export function GaConnectCard({ pageId, idToken }: { pageId: string; idToken: string }) {
  const [saEmail, setSaEmail] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [savedId, setSavedId] = useState('')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const headers = useCallback(() => ({ Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }), [idToken])

  useEffect(() => {
    if (!pageId || !idToken) return
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/analytics/ga/config?pageId=${pageId}`, { headers: headers() })
      if (!res.ok || cancelled) return
      const d = await res.json()
      if (cancelled) return
      setSaEmail(d.serviceAccountEmail ?? '')
      setPropertyId(d.propertyId ?? '')
      setSavedId(d.propertyId ?? '')
      setMsg(null)
    })()
    return () => { cancelled = true }
  }, [pageId, idToken, headers])

  function copyEmail() {
    navigator.clipboard?.writeText(saEmail)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/analytics/ga/config', { method: 'POST', headers: headers(), body: JSON.stringify({ pageId, propertyId }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: d.error ?? '儲存失敗' }); return }
      setSavedId(d.propertyId ?? '')
      setMsg({ kind: 'ok', text: '已儲存 Property ID，按「測試連線」確認權限是否生效。' })
    } finally { setSaving(false) }
  }

  async function test() {
    setTesting(true); setMsg(null)
    try {
      const res = await fetch('/api/analytics/ga/sync', { method: 'POST', headers: headers(), body: JSON.stringify({ pageId }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: `連線失敗：${d.error ?? '未知錯誤'}（請確認已把上方 email 加為 GA4 檢視者）` }); return }
      const s = d.summary
      setMsg({ kind: 'ok', text: `✅ 連線成功！抓到 ${s?.channels?.length ?? 0} 個管道、營收 $${Math.round(s?.totals?.revenue ?? 0).toLocaleString('zh-TW')}${s?.adsLinked ? `、ROAS ${s.totals.roas}x` : '（GA4 未連 Google Ads，無廣告花費）'}` })
    } finally { setTesting(false) }
  }

  const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: 'white' }
  const step: React.CSSProperties = { fontSize: 13, color: '#374151', lineHeight: 1.7, marginBottom: 10 }

  return (
    <div style={box}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 電商成效（GA4）串接</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>若你用 Google Ads / 有網站 GA4，連接後可在儀表板看營收、轉換、各管道 ROAS。</p>

      <div style={step}>
        <b>① 複製我們的存取帳號</b>，到你的 GA4「管理 → 資源存取權管理」把它加為「<b>檢視者</b>」：
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <code style={{ flex: 1, fontSize: 12, background: '#f3f4f6', padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all' }}>{saEmail || '載入中…'}</code>
          <button onClick={copyEmail} disabled={!saEmail}
            style={{ flexShrink: 0, padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: copied ? '#16a34a' : '#2563eb', color: 'white', cursor: 'pointer' }}>
            {copied ? '已複製 ✓' : '複製'}
          </button>
        </div>
      </div>

      <div style={step}>
        <b>② 貼上你的 GA4 Property ID</b>（在 GA4「管理 → 資源設定」，純數字）：
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input value={propertyId} onChange={e => setPropertyId(e.target.value)} placeholder="例如 123456789"
            style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
          <button onClick={save} disabled={saving || propertyId === savedId}
            style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: (saving || propertyId === savedId) ? '#9ca3af' : '#2563eb', color: 'white', cursor: 'pointer' }}>
            {saving ? '⋯' : '儲存'}
          </button>
        </div>
      </div>

      <div style={step}>
        <b>③ 測試連線</b>：
        <button onClick={test} disabled={testing || !savedId}
          style={{ marginLeft: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: (testing || !savedId) ? 'default' : 'pointer' }}>
          {testing ? '⋯ 測試中' : '↻ 測試連線'}
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
