'use client'
import { Fragment, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface LinkRow {
  slug: string
  shortUrl: string
  label: string
  destination: string
  clickCount: number
  conversionCount: number
  value: number
  currency: string
  trackConversion: boolean
  conversionUrl: string | null
  webhookUrl: string | null
  paramName: string | null
  createdAt: string | null
}
interface PageOpt { pageId: string; pageName: string }

export default function LinksPage() {
  const { L } = useLang()
  const router = useRouter()
  const [idToken, setIdToken] = useState('')
  const [pages, setPages] = useState<PageOpt[]>([])
  const [pageId, setPageId] = useState('')
  const [links, setLinks] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [destination, setDestination] = useState('')
  const [label, setLabel] = useState('')
  const [track, setTrack] = useState(false)
  const [thankYouUrl, setThankYouUrl] = useState('')
  const [value, setValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [openSetup, setOpenSetup] = useState('')

  const load = useCallback(async (token: string, pid: string) => {
    const res = await fetch(`/api/links?pageId=${pid}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setLinks((await res.json()).links ?? [])
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const res = await fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } })
      const adminPages: PageOpt[] = res.ok ? ((await res.json()).pages ?? []) : []
      if (adminPages.length === 0) { router.replace('/dashboard'); return }
      setPages(adminPages)
      const pid = localStorage.getItem('selectedPageId') ?? adminPages[0].pageId
      const valid = adminPages.find(p => p.pageId === pid)?.pageId ?? adminPages[0].pageId
      setPageId(valid)
      await load(token, valid)
      setLoading(false)
    })
    return unsub
  }, [router, load])

  async function switchPage(pid: string) {
    setPageId(pid); localStorage.setItem('selectedPageId', pid)
    await load(idToken, pid)
  }

  async function create() {
    if (!destination.trim() || !pageId) return
    setCreating(true); setErr('')
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, destination: destination.trim(), label: label.trim(), trackConversion: track, thankYouUrl: thankYouUrl.trim() || undefined, value: Number(value) || 0 }),
    })
    if (res.ok) {
      const d = await res.json()
      setDestination(''); setLabel(''); setThankYouUrl(''); setValue('')
      await load(idToken, pageId)
      if (d.trackConversion) setOpenSetup(d.slug) // jump straight to setup steps
    } else { const d = await res.json().catch(() => ({})); setErr(d.error ?? L('建立失敗', 'Failed to create')) }
    setCreating(false)
  }

  async function remove(slug: string) {
    if (!confirm(L('確定停用這條短網址？舊連結會失效。', 'Disable this short link? The old URL will stop working.'))) return
    await fetch('/api/links', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, slug }),
    })
    await load(idToken, pageId)
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(text); setTimeout(() => setCopied(''), 1500)
  }

  function exportCsv() {
    const head = ['label', 'shortUrl', 'destination', 'clicks', 'conversions', 'conversionRate']
    const rows = links.map(l => [
      l.label, l.shortUrl, l.destination, l.clickCount, l.conversionCount,
      l.clickCount > 0 ? `${Math.round((l.conversionCount / l.clickCount) * 100)}%` : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [head.join(','), ...rows].join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `links-${pageId}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">{L('載入中…', 'Loading…')}</div>

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">🔗 {L('報名連結追蹤', 'Registration Link Tracking')}</h1>
        <button onClick={() => router.push('/dashboard')} className="text-xs font-semibold text-gray-400 hover:text-gray-600">
          {L('← 回儀表板', '← Back')}
        </button>
      </div>

      {pages.length > 1 && (
        <select value={pageId} onChange={e => switchPage(e.target.value)}
          className="mb-4 rounded-lg border border-gray-200 px-3 py-2 text-sm">
          {pages.map(p => <option key={p.pageId} value={p.pageId}>{p.pageName || p.pageId}</option>)}
        </select>
      )}

      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        {L('把報名表連結貼進來產生短網址，放到貼文／廣告。系統記錄點擊；若開啟「追蹤報名完成」，再依你設定的表單回報，算出真實報名轉換率。',
          'Paste a registration form link to get a short URL for your post/ad. Clicks are tracked; enable conversion tracking to also measure who actually registered.')}
      </p>

      {/* Meta ROAS reporting (CAPI) */}
      {pageId && <MetaCapiCard pageId={pageId} idToken={idToken} L={L} />}

      {/* Create */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <label className="mb-1 block text-xs font-semibold text-gray-600">{L('報名表連結', 'Registration form link')}</label>
        <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="https://forms.gle/..."
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <label className="mb-1 block text-xs font-semibold text-gray-600">{L('標籤（選填，方便辨認）', 'Label (optional)')}</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder={L('如：5/1 IG 貼文', 'e.g. May 1 IG post')}
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />

        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={track} onChange={e => setTrack(e.target.checked)} className="h-4 w-4" />
          {L('追蹤報名完成（需在表單做一次設定）', 'Track registration completion (one-time form setup)')}
        </label>
        {track && (
          <div className="mb-3 rounded-lg bg-blue-50 p-3">
            <label className="mb-1 block text-xs font-semibold text-gray-600">{L('報名金額（免費活動填 0）', 'Registration fee (0 if free)')}</label>
            <div className="mb-2 flex items-center gap-2">
              <input type="number" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="150"
                className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <span className="text-xs text-gray-500">TWD</span>
            </div>
            <p className="mb-2 text-[11px] text-gray-500">{L('有金額 → 回報 Meta「Purchase」算 ROAS；填 0 → 回報「報名完成」當轉換數。', '>0 → reports Meta “Purchase” for ROAS; 0 → reports “CompleteRegistration” as a conversion.')}</p>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{L('完成後導向（感謝頁，選填）', 'Redirect after completion (optional)')}</label>
            <input value={thankYouUrl} onChange={e => setThankYouUrl(e.target.value)} placeholder="https://..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <p className="mt-1 text-[11px] text-gray-500">{L('建立後會給你「完成回報網址」與逐平台設定步驟。', 'After creating, you’ll get a conversion URL and per-platform setup steps.')}</p>
          </div>
        )}
        {err && <p className="mb-2 text-xs text-red-500">{err}</p>}
        <button onClick={create} disabled={creating || !destination.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">
          {creating ? L('產生中…', 'Creating…') : L('產生短網址', 'Create short link')}
        </button>
      </div>

      {/* List */}
      {links.length === 0
        ? <p className="text-sm text-gray-400">{L('尚無連結。', 'No links yet.')}</p>
        : (
          <>
            <div className="mb-2 flex justify-end">
              <button onClick={exportCsv} className="text-xs font-semibold text-gray-400 hover:text-gray-600">{L('⬇ 匯出 CSV', '⬇ Export CSV')}</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                    <th className="px-4 py-2 font-semibold">{L('連結', 'Link')}</th>
                    <th className="px-3 py-2 text-center font-semibold">{L('點擊', 'Clicks')}</th>
                    <th className="px-3 py-2 text-center font-semibold">{L('完成', 'Done')}</th>
                    <th className="px-3 py-2 text-center font-semibold">{L('轉換率', 'Rate')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(l => (
                    <Fragment key={l.slug}>
                      <tr className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3">
                          {l.label && <div className="text-xs font-semibold text-gray-700">{l.label}</div>}
                          <button onClick={() => copy(l.shortUrl)} className="font-mono text-xs text-blue-600 hover:underline">
                            {l.shortUrl.replace(/^https?:\/\//, '')}
                            <span className="ml-1 text-gray-400">{copied === l.shortUrl ? L('✓ 已複製', '✓ Copied') : '⧉'}</span>
                          </button>
                          <div className="max-w-xs truncate text-[11px] text-gray-400">→ {l.destination}</div>
                          {l.trackConversion && l.value > 0 && (
                            <div className="text-[11px] text-gray-500">{L('金額', 'Fee')} {l.value} {l.currency} · {L('營收', 'Revenue')} {l.conversionCount * l.value} {l.currency}</div>
                          )}
                          {l.trackConversion && (
                            <button onClick={() => setOpenSetup(openSetup === l.slug ? '' : l.slug)} className="mt-1 text-[11px] font-semibold text-purple-500 hover:underline">
                              {openSetup === l.slug ? L('▾ 收起設定教學', '▾ Hide setup') : L('▸ 表單設定教學', '▸ Form setup steps')}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center text-base font-bold text-gray-800">{l.clickCount}</td>
                        <td className="px-3 py-3 text-center text-base font-bold text-gray-800">{l.trackConversion ? l.conversionCount : '—'}</td>
                        <td className="px-3 py-3 text-center text-xs font-semibold text-green-600">
                          {l.trackConversion && l.clickCount > 0 ? `${Math.round((l.conversionCount / l.clickCount) * 100)}%` : '—'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => remove(l.slug)} className="text-xs text-gray-400 hover:text-red-500">{L('停用', 'Disable')}</button>
                        </td>
                      </tr>
                      {openSetup === l.slug && l.trackConversion && (
                        <tr className="border-b border-gray-50">
                          <td colSpan={5} className="bg-gray-50 px-4 py-3">
                            <SetupGuide link={l} copy={copy} copied={copied} L={L} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  )
}

function Field({ label, value, copy, copied }: { label: string; value: string; copy: (s: string) => void; copied: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold text-gray-500">{label}</div>
      <button onClick={() => copy(value)} className="block w-full break-all rounded border border-gray-200 bg-white px-2 py-1 text-left font-mono text-[11px] text-gray-700 hover:border-blue-300">
        {value} <span className="text-gray-400">{copied === value ? '✓' : '⧉'}</span>
      </button>
    </div>
  )
}

function SetupGuide({ link, copy, copied, L }: { link: LinkRow; copy: (s: string) => void; copied: string; L: (zh: string, en: string) => string }) {
  return (
    <div className="text-xs leading-relaxed text-gray-600">
      <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">⚠️ {L('重要：把廣告的「目的地網址」設成上面這條短網址（不要直接指向報名表），ROAS 才歸得到該支廣告。', 'Important: set your ad’s destination to the short URL above (not the form directly), or ROAS can’t be attributed to the ad.')}</p>
      {link.conversionUrl && <Field label={L('完成回報網址（貼到表單「送出後導向」）', 'Conversion URL (paste into form’s “after-submit redirect”)')} value={link.conversionUrl} copy={copy} copied={copied} />}
      {link.webhookUrl && <Field label={L('Webhook 網址（Tally/Typeform 用）', 'Webhook URL (Tally/Typeform)')} value={link.webhookUrl} copy={copy} copied={copied} />}
      <p className="mt-2 font-semibold text-gray-700">{L('依你的表單平台擇一設定：', 'Pick the steps for your form platform:')}</p>
      <ul className="ml-4 mt-1 list-disc space-y-1">
        <li><b>Tally / Typeform：</b>{L('表單設定 → 送出後導向，貼上「完成回報網址」；或設 Webhook 用上面網址，並加一個隱藏欄位 ', 'Settings → redirect after submit, paste the Conversion URL; or add the Webhook above plus a hidden field ')}<code className="rounded bg-gray-200 px-1">cl_id</code></li>
        <li><b>SurveyCake：</b>{L('結束設定 → 結束導向，貼上「完成回報網址」。', 'End settings → redirect, paste the Conversion URL.')}</li>
        <li><b>Google {L('表單', 'Forms')}：</b>{L('原生不支援，需在表單加 Apps Script onFormSubmit 呼叫 Webhook（或改用 Tally）。', 'Not supported natively — add an Apps Script onFormSubmit trigger calling the Webhook (or switch to Tally).')}</li>
      </ul>
    </div>
  )
}

function MetaCapiCard({ pageId, idToken, L }: { pageId: string; idToken: string; L: (zh: string, en: string) => string }) {
  const [open, setOpen] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [pixelId, setPixelId] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!pageId || !idToken) return
    fetch(`/api/integrations/meta-capi?pageId=${pageId}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setConfigured(d.configured); setPixelId(d.pixelId ?? '') } })
      .catch(() => {})
  }, [pageId, idToken])

  async function save() {
    if (!pixelId.trim() || !token.trim()) return
    setStatus('saving'); setMsg('')
    const res = await fetch('/api/integrations/meta-capi', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, pixelId: pixelId.trim(), accessToken: token.trim() }),
    })
    if (res.ok) { setStatus('ok'); setConfigured(true); setToken(''); setMsg(L('✅ 已連線並通過測試事件', '✅ Connected — test event passed')) }
    else { const d = await res.json().catch(() => ({})); setStatus('err'); setMsg(d.error ?? L('連線失敗', 'Connection failed')) }
  }

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-bold text-gray-800">
          📈 {L('Meta 轉換回報 (ROAS)', 'Meta Conversion Reporting (ROAS)')}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {configured ? L('已連線', 'Connected') : L('未設定', 'Not set')}
          </span>
        </span>
        <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-[11px] leading-relaxed text-gray-500">
            {L('一次性設定：貼上 Meta Events Manager 的 Pixel/Dataset ID 與 Conversions API access token，之後有人完成報名，ContentLoop 會自動回報金額給 Meta 算 ROAS（不需要你碰像素代碼）。',
              'One-time setup: paste your Pixel/Dataset ID and Conversions API access token from Meta Events Manager. ContentLoop then auto-reports each registration’s value to Meta for ROAS — no pixel code needed.')}
          </p>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Pixel / Dataset ID</label>
          <input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="1234567890"
            className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <label className="mb-1 block text-xs font-semibold text-gray-600">{L('Conversions API access token', 'Conversions API access token')}</label>
          <input value={token} onChange={e => setToken(e.target.value)} type="password" placeholder={configured ? L('（已儲存，留空不變）', '(saved — leave blank to keep)') : 'EAAB...'}
            className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          {msg && <p className={`mb-2 text-xs ${status === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
          <button onClick={save} disabled={status === 'saving' || !pixelId.trim() || !token.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">
            {status === 'saving' ? L('測試連線中…', 'Testing…') : L('儲存並測試連線', 'Save & test connection')}
          </button>
          <p className="mt-2 text-[11px] text-gray-400">
            {L('在 Events Manager → 你的資料集 → 設定 → Conversions API → 產生存取權杖。', 'In Events Manager → your dataset → Settings → Conversions API → Generate access token.')}
          </p>
        </div>
      )}
    </div>
  )
}
