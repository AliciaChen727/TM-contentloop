'use client'
import { Fragment, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { CapiSetupWizard } from '@/components/links/CapiSetupWizard'

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
      {pageId && <MetaCapiCard key={pageId} pageId={pageId} idToken={idToken} L={L} />}

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

// A copy-able code block (used for the Google Forms Apps Script snippets).
function CodeBlock({ code, copy, copied, L }: { code: string; copy: (s: string) => void; copied: string; L: (zh: string, en: string) => string }) {
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-gray-500">{L('Apps Script 程式碼', 'Apps Script code')}</span>
        <button onClick={() => copy(code)}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100">
          {copied === code ? L('✓ 已複製', '✓ Copied') : L('📋 複製程式碼', '📋 Copy code')}
        </button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-900 p-2.5 text-[10px] leading-snug text-gray-100">{code}</pre>
    </div>
  )
}

// Guide screenshot (static asset under /public/guides). Plain img is fine here —
// these are fixed-size tutorial images, not user content needing optimization.
function GuideImg({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="w-full max-w-md rounded-lg border border-gray-200 shadow-sm" />
}

function SetupGuide({ link, copy, copied, L }: { link: LinkRow; copy: (s: string) => void; copied: string; L: (zh: string, en: string) => string }) {
  const webhook = link.webhookUrl ?? ''
  const trigger = `// 只需執行一次：建立「表單送出時」自動觸發器
function setupCL() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmitCL') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmitCL')
    .forForm(FormApp.getActiveForm())
    .onFormSubmit().create();
}`
  // 做法 A：只要 ContentLoop 自家「完成/營收」— 表單免加欄位，送出即計一筆。
  const gasSimple = `// === ContentLoop 報名完成回報（簡單版：只算完成/營收）===
var WEBHOOK_URL = '${webhook}';

function onFormSubmitCL(e) {
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ via: 'google-form' }), muteHttpExceptions: true
  });
}

${trigger}`
  // 做法 B：要 Meta ROAS — 表單需有一題承載 cl_id（標題可自取，值填 __CLID__）。
  const gasRoas = `// === ContentLoop 報名完成回報（Meta ROAS 版）===
var WEBHOOK_URL = '${webhook}';
var FIELD_TITLE = '專屬報名序號（系統自動帶入，請勿修改）';  // ← 跟你表單那一題的「標題」一字不差 (該題的值填 __CLID__)

function onFormSubmitCL(e) {
  var v = e.namedValues || {};
  var clId = (v[FIELD_TITLE] && v[FIELD_TITLE][0]) || '';
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ cl_id: clId }), muteHttpExceptions: true
  });
}

${trigger}`
  return (
    <div className="text-xs leading-relaxed text-gray-600">
      <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">⚠️ {L('這兩個網址是「同一條連結」的一組，slug 要一樣才會串起來：① 貼廣告、② 貼表單。不要直接把報名表連結拿去投廣告。', 'These two URLs are a pair from the SAME link (same slug) — they only tie back if matched: ① goes in the ad, ② goes in the form. Don’t put the raw form link in the ad.')}</p>
      <div className="mb-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2.5">
        <Field label={L('① 廣告目的地網址 → 貼到廣告／貼文（算「有幾個人點進報名表」）', '① Ad destination URL → paste into the ad/post (counts “how many clicked through to the form”)')} value={link.shortUrl} copy={copy} copied={copied} />
        {link.conversionUrl && <Field label={L('② 完成回報網址 → 貼到表單「送出後導向」（算「有幾個人真的填完報名表」）', '② Conversion URL → paste into the form’s “after-submit redirect” (counts “how many actually finished the form”)')} value={link.conversionUrl} copy={copy} copied={copied} />}
        <p className="text-[11px] text-blue-700">{L('兩個都是這條的 slug；別跟其他連結的 /r 或 /c 混用。', 'Both use this link’s slug — don’t mix with another link’s /r or /c.')}</p>
      </div>
      {link.webhookUrl && <Field label={L('Webhook 網址（Tally/Typeform 用）', 'Webhook URL (Tally/Typeform)')} value={link.webhookUrl} copy={copy} copied={copied} />}
      <p className="mt-2 font-semibold text-gray-700">{L('依你的表單平台擇一設定：', 'Pick the steps for your form platform:')}</p>
      <ul className="ml-4 mt-1 list-disc space-y-1">
        <li><b>Tally / Typeform：</b>{L('表單設定 → 送出後導向，貼上「完成回報網址」；或設 Webhook 用上面網址，並加一個隱藏欄位 ', 'Settings → redirect after submit, paste the Conversion URL; or add the Webhook above plus a hidden field ')}<code className="rounded bg-gray-200 px-1">cl_id</code></li>
        <li><b>SurveyCake：</b>{L('結束設定 → 結束導向，貼上「完成回報網址」。', 'End settings → redirect, paste the Conversion URL.')}</li>
      </ul>

      {/* Google Forms: two tutorials — A) ContentLoop revenue only, B) Meta ROAS */}
      <p className="mt-3 font-semibold text-gray-700">{L('Google 表單（兩種做法，依需求選一）：', 'Google Forms (two paths — pick by need):')}</p>

      {/* 做法 A：只看 ContentLoop 自家完成/營收 */}
      <details className="mt-1.5 rounded-lg border border-green-200 bg-green-50/40">
        <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-green-800">
          🟢 {L('做法 A：只看 ContentLoop 自家「完成數／轉換率／營收」（簡單，表單免改）', 'Path A: ContentLoop’s own completions/rate/revenue only (simple, no form change)')}
        </summary>
        <div className="space-y-3 border-t border-green-200 px-3 py-3">
          <p className="break-words text-[11px] text-gray-600">{L('Google 表單送出後不能自訂導向，所以「②完成回報網址」用不到；改用 Apps Script 在送出時打 webhook。表單免加任何欄位、填答者看不到任何代碼。',
            'Google Forms can’t redirect after submit, so the ② Conversion URL won’t work; use Apps Script to ping the webhook on submit. No form field needed — respondents see nothing.')}</p>
          <div>
            <p className="font-semibold text-gray-700">🟩 {L('地方一：ContentLoop（此頁上方）', 'Place 1: ContentLoop (top of page)')}</p>
            <p className="ml-1">{L('把 Google 表單連結直接當「報名表連結」貼上，勾「追蹤報名完成」、填金額，產生短網址。', 'Paste your Google Form link as the form link, tick “Track completion”, set the fee, create the short link.')}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">🟨 {L('地方二：Apps Script（貼一次）', 'Place 2: Apps Script (one-time)')}</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>{L('表單 → 右上 ⋮ → 指令碼編輯器（Apps Script）', 'Form → top-right ⋮ → Script editor (Apps Script)')}</li>
              <li>{L('刪掉預設內容，貼上下面整段（WEBHOOK_URL 已自動帶入這條）', 'Replace the default code with the block below (WEBHOOK_URL pre-filled for this link)')}</li>
              <li>{L('函式選 setupCL → ▶ 執行 → 授權（進階 → 前往 → 允許）', 'Pick setupCL → ▶ Run → authorize (Advanced → Go → Allow)')}</li>
            </ol>
            <CodeBlock code={gasSimple} copy={copy} copied={copied} L={L} />
          </div>
          <p className="text-[11px] text-gray-500">✅ {L('自測：點短網址 → 填表 → 送出 → 列表「完成 +1」、營收 = 完成數 × 金額。', 'Test: open short link → fill → submit → “Done +1”; revenue = completions × fee.')}</p>
          <p className="text-[11px] text-gray-400">{L('※ 這條算的是 ContentLoop 自家數字；Meta Ads Manager 的 ROAS 不會動，要的話用做法 B。', '※ This is ContentLoop’s own metric; Meta Ads Manager ROAS won’t move — use Path B for that.')}</p>
        </div>
      </details>

      {/* 做法 B：要 Meta Ads Manager ROAS */}
      <details className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50/40">
        <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-blue-800">
          🔵 {L('做法 B：要 Meta Ads Manager／儀表板的 ROAS（進階，表單加 1 題）', 'Path B: Meta Ads Manager / dashboard ROAS (advanced, +1 form question)')}
        </summary>
        <div className="space-y-3 border-t border-blue-200 px-3 py-3">
          <p className="break-words text-[11px] text-gray-600">{L('比做法 A 多一個欄位，讓「點擊識別碼」隨表單送出，Meta 才能把 Purchase 歸因到廣告算 ROAS。另需：廣告活動為購買／轉換目標、CAPI 已連線。',
            'One extra field carries the click ID with the submission so Meta can attribute the Purchase to the ad for ROAS. Also requires: a purchase/conversion-objective campaign and CAPI connected.')}</p>
          <div>
            <p className="font-semibold text-gray-700">🟦 {L('地方一：Google 表單加一題', 'Place 1: add one question to the form')}</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>{L('加一題「簡答（Short answer）」，標題打：專屬報名序號（系統自動帶入，請勿修改）。只要標題＋類型，別加說明、別加驗證、必填關掉。', 'Add a “Short answer” question titled: 專屬報名序號（系統自動帶入，請勿修改）. Title + type only — no description, no validation, Required off.')}</li>
              <li><b className="text-blue-700">{L('編輯這一題時「不要」打 __CLID__。', 'Do NOT type __CLID__ while editing the question.')}</b>{L('右上 ⋮ → 取得預先填入的連結 → 畫面變「填表預覽」→ 在這一題的答案框打 ', ' Top-right ⋮ → Get pre-filled link → the form opens in fill mode → in this question’s answer box type ')}<code className="rounded bg-gray-200 px-1">__CLID__</code>{L(' → 取得連結 → 複製。', ' → Get link → Copy.')}</li>
            </ol>
            <p className="ml-1 text-[11px] text-blue-700">{L('欄位標題可隨意改，但「取得預填連結」那步那一題的值一定要填 __CLID__（ContentLoop 會在點擊時換成真實識別碼）。', 'Rename the field freely, but in the “pre-filled link” step that question’s value must be __CLID__ (ContentLoop swaps it for the real ID at click time).')}</p>
            {/* Real screenshots: correct editor state → where to click → fill preview */}
            <div className="mt-2 space-y-2">
              <div>
                <p className="mb-1 text-[11px] text-gray-500">{L('① 編輯這一題時長這樣（標題＋Short answer，Description 空白、Required 關、無驗證）：', '① The question editor should look like this (title + Short answer; Description empty, Required off, no validation):')}</p>
                <GuideImg src="/guides/capi/gform-question.png" alt="Question editor correct state" />
              </div>
              <div>
                <p className="mb-1 text-[11px] text-gray-500">{L('② 右上 ⋮ → 點「Pre-fill form（取得預先填入的連結）」：', '② Top-right ⋮ → click “Pre-fill form”:')}</p>
                <GuideImg src="/guides/capi/gform-menu.png" alt="Pre-fill form menu" />
              </div>
              <div>
                <p className="mb-1 text-[11px] text-gray-500">{L('③ 在填表預覽裡，於「專屬報名序號」那格打 __CLID__：', '③ In the fill preview, type __CLID__ in the 專屬報名序號 box:')}</p>
                <GuideImg src="/guides/capi/gform-prefill.png" alt="Pre-fill __CLID__ example" />
              </div>
              <div>
                <p className="mb-1 text-[11px] text-gray-500">{L('④ 拉到最下面按「Get link」→ 黑色長條按「COPY LINK」複製，這條就是要貼進 ContentLoop 的報名表連結：', '④ Scroll down, click “Get link” → in the black bar click “COPY LINK”; this is the link to paste into ContentLoop:')}</p>
                <GuideImg src="/guides/capi/gform-getlink.png" alt="Get link and copy" />
              </div>
              <p className="text-[10px] leading-relaxed text-amber-700">{L('注意：編輯題目的畫面那格是「空白」的（打不進去）；只有在「取得預先填入的連結」的填表預覽才打 __CLID__。別加數字驗證、別設必填。',
                'Note: in the question EDITOR that box is empty (can’t type a value); only type __CLID__ in the “Pre-fill form” fill preview. No number validation, not required.')}</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-gray-700">🟩 {L('地方二：ContentLoop（此頁上方）', 'Place 2: ContentLoop (top of page)')}</p>
            <p className="ml-1">{L('把上面複製的「預填連結」（含 __CLID__）當「報名表連結」貼上，勾「追蹤報名完成」、填金額。', 'Paste the pre-filled link (with __CLID__) as the form link, tick “Track completion”, set the fee.')}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">🟨 {L('地方三：Apps Script（貼一次）', 'Place 3: Apps Script (one-time)')}</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>{L('表單 → 右上 ⋮ → 指令碼編輯器 → 貼下面整段', 'Form → ⋮ → Script editor → paste the block below')}</li>
              <li>{L('把 FIELD_TITLE 改成你那一題的標題（要跟表單一字不差）', 'Set FIELD_TITLE to your question’s title (must match exactly)')}</li>
              <li>{L('函式選 setupCL → ▶ 執行 → 授權', 'Pick setupCL → ▶ Run → authorize')}</li>
            </ol>
            <CodeBlock code={gasRoas} copy={copy} copied={copied} L={L} />
          </div>
          <p className="text-[11px] text-gray-500">✅ {L('自測：點短網址 → 表單（識別碼已自動填，別動）→ 送出 → 列表「完成 +1」；Events Manager「測試事件」收到 Purchase。', 'Test: open short link → form (ID auto-filled, don’t touch) → submit → “Done +1”; Events Manager shows a Purchase.')}</p>
        </div>
      </details>
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
  const [wizard, setWizard] = useState(false)

  useEffect(() => {
    if (!pageId || !idToken) return
    fetch(`/api/integrations/meta-capi?pageId=${pageId}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setConfigured(d.configured); setPixelId(d.pixelId ?? '') } })
      .catch(() => {})
  }, [pageId, idToken])

  // Single source of truth for the save call; used by both the inline button and
  // the wizard's final step (which passes its own pixelId/token).
  async function doSave(pid: string, tok: string): Promise<{ ok: boolean; msg: string }> {
    const res = await fetch('/api/integrations/meta-capi', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, pixelId: pid, accessToken: tok }),
    })
    if (res.ok) {
      setConfigured(true); setPixelId(pid)
      return { ok: true, msg: L('✅ 已連線並通過測試事件', '✅ Connected — test event passed') }
    }
    const d = await res.json().catch(() => ({}))
    return { ok: false, msg: d.error ?? L('連線失敗', 'Connection failed') }
  }

  async function save() {
    if (!pixelId.trim() || !token.trim()) return
    setStatus('saving'); setMsg('')
    const r = await doSave(pixelId.trim(), token.trim())
    setStatus(r.ok ? 'ok' : 'err'); setMsg(r.msg)
    if (r.ok) setToken('')
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
          <button onClick={() => setWizard(true)}
            className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
            🧭 {L('不知道怎麼拿？開啟設定精靈', 'Not sure how? Open setup wizard')}
          </button>
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
      {wizard && (
        <CapiSetupWizard L={L} configured={configured} onSave={doSave} onClose={() => setWizard(false)} />
      )}
    </div>
  )
}
