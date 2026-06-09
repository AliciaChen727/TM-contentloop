'use client'

import { useCallback, useEffect, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import type { GaSummary } from '@/lib/analytics/gaTypes'
import { useLang } from '@/lib/i18n/LanguageProvider'

const fmtNum = (n: number) => n.toLocaleString('zh-TW')
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--ad-border)', borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 12, color: 'var(--ad-text3)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function GaSection({ pageId, since, until }: { pageId: string; since?: string; until?: string }) {
  const { L } = useLang()
  const [summary, setSummary] = useState<GaSummary | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const headers = useCallback(async () => {
    const t = await auth.currentUser?.getIdToken()
    return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  }, [])

  // Read stored snapshot on mount
  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    ;(async () => {
      try {
        const h = await headers()
        const res = await fetch(`/api/analytics/ga/sync?pageId=${pageId}`, { headers: h })
        const d = await res.json()
        if (cancelled) return
        setConfigured(d.configured ?? false)
        setSummary(d.summary ?? null)
      } catch { /* non-critical */ }
    })()
    return () => { cancelled = true }
  }, [pageId, headers])

  async function sync() {
    setLoading(true); setError('')
    try {
      const h = await headers()
      const res = await fetch('/api/analytics/ga/sync', {
        method: 'POST', headers: h,
        body: JSON.stringify({ pageId, since, until }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? L('同步失敗', 'Sync failed')); setConfigured(d.configured ?? configured); return }
      setConfigured(true); setSummary(d.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : L('發生錯誤', 'An error occurred'))
    } finally { setLoading(false) }
  }

  if (configured === false) {
    return (
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '16px 20px', fontSize: 13, color: '#92400e', lineHeight: 1.7 }}>
        ⚠️ {L('尚未設定 GA4。請到設定填入此粉專的 ', 'GA4 not set up yet. In Settings, enter this page\'s ')}<b>GA4 Property ID</b>{L('，並將我們的 service account 加為該 GA4 資源的「檢視者」後即可同步電商成效。', ' and add our service account as a "Viewer" on that GA4 property to sync e-commerce performance.')}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>📊 {L('電商成效（GA4）', 'E-commerce Performance (GA4)')}</span>
        <button onClick={sync} disabled={loading}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: loading ? '#94a3b8' : 'var(--ad-blue)', color: 'white', cursor: loading ? 'default' : 'pointer' }}>
          {loading ? L('⋯ 同步中', '⋯ Syncing') : L('↻ 同步 GA4', '↻ Sync GA4')}
        </button>
      </div>

      {error && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13 }}>❌ {error}</div>}

      {!summary && !error && (
        <div style={{ fontSize: 13, color: 'var(--ad-text3)' }}>{L('尚未有資料，按「同步 GA4」抓取。', 'No data yet — click "Sync GA4" to fetch.')}</div>
      )}

      {summary && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <Card label={L('營收', 'Revenue')} value={fmtMoney(summary.totals.revenue)} sub={L(`${fmtNum(summary.totals.purchases)} 筆購買`, `${fmtNum(summary.totals.purchases)} purchases`)} />
            <Card label={L('轉換數', 'Conversions')} value={fmtNum(summary.totals.conversions)} />
            <Card label={L('工作階段', 'Sessions')} value={fmtNum(summary.totals.sessions)} sub={L(`${fmtNum(summary.totals.users)} 使用者`, `${fmtNum(summary.totals.users)} users`)} />
            {summary.adsLinked
              ? <>
                  <Card label={L('Google 廣告花費', 'Google Ads spend')} value={fmtMoney(summary.totals.adCost)} sub={L(`${fmtNum(summary.totals.adClicks)} 點擊`, `${fmtNum(summary.totals.adClicks)} clicks`)} />
                  <Card label="ROAS" value={`${summary.totals.roas}x`} />
                </>
              : <Card label={L('Google 廣告', 'Google Ads')} value={L('未連結', 'Not linked')} sub={L('GA4 未連 Google Ads', 'GA4 not linked to Google Ads')} />}
          </div>

          <div style={{ fontSize: 11, color: 'var(--ad-text3)', textAlign: 'right', marginBottom: 10 }}>
            {L('資料區間', 'Data range')} {summary.dateRange.from} ~ {summary.dateRange.to}
          </div>

          <div style={{ background: 'white', border: '1px solid var(--ad-border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', textAlign: 'right', color: 'var(--ad-text2)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600 }}>{L('管道', 'Channel')}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>{L('工作階段', 'Sessions')}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>{L('轉換', 'Conversions')}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>{L('營收', 'Revenue')}</th>
                  {summary.adsLinked && <th style={{ padding: '10px 14px', fontWeight: 600 }}>{L('廣告花費', 'Ad spend')}</th>}
                  {summary.adsLinked && <th style={{ padding: '10px 14px', fontWeight: 600 }}>ROAS</th>}
                </tr>
              </thead>
              <tbody>
                {summary.channels.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--ad-border)', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: '10px 14px' }}>{c.channel}</td>
                    <td style={{ padding: '10px 14px' }}>{fmtNum(c.sessions)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmtNum(c.conversions)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmtMoney(c.revenue)}</td>
                    {summary.adsLinked && <td style={{ padding: '10px 14px' }}>{fmtMoney(c.adCost)}</td>}
                    {summary.adsLinked && <td style={{ padding: '10px 14px' }}>{c.roas ? `${c.roas}x` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
