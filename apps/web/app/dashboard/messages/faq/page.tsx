'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { parseSchedule, nextMeeting, type ParsedEntry } from '@/lib/messages/parseSchedule'
import { trackEvent } from '@/lib/analytics/track'

interface IntentMeta { key: string; zh: string; en: string }
interface Answer { answer: string; enabled: boolean }
interface Config {
  enabled: boolean
  humanHandoffEnabled: boolean
  fallbackMessage: string
  persona: string
  knowledgeBase: string
  answers: Record<string, Answer>
  scheduleEntries: ParsedEntry[]
  meetingTime: string
  meetingLocation: string
  scheduleSheetUrl: string
  replyModel: 'standard' | 'advanced'
  corrections: Correction[]
}
interface Correction { text: string; fromMessage?: string; createdAt?: string; by?: string }
interface PreviewResult { action: 'reply' | 'handoff'; text: string; intent: string; model?: string; groundingUsed: string[] }
interface FeedbackStats { up: number; down: number; total: number; topDownIntents: { intent: string; up: number; down: number }[]; recentDown: { message: string; reason: string; intent: string; createdAt: string }[] }
interface InboxItem { platform: 'IG' | 'FB'; text: string; action: 'reply' | 'handoff'; reply: string; intent: string; wouldSend: boolean; createdAt: string }

export default function FaqSettingsPage() {
  const router = useRouter()
  const { L } = useLang()
  const [token, setToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [pageName, setPageName] = useState('')
  const [intents, setIntents] = useState<IntentMeta[]>([])
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [paste, setPaste] = useState('')
  const [saEmail, setSaEmail] = useState('')
  const [syncingSheet, setSyncingSheet] = useState(false)
  const [sheetErr, setSheetErr] = useState('')
  const [previewInput, setPreviewInput] = useState('')
  const [previewAsked, setPreviewAsked] = useState('')
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [feedbackReason, setFeedbackReason] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [fbStats, setFbStats] = useState<FeedbackStats | null>(null)
  const [inbox, setInbox] = useState<InboxItem[]>([])

  const loadFbStats = useCallback(async (t: string, pid: string) => {
    try {
      const res = await fetch(`/api/messages/faq/feedback?pageId=${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${t}` } })
      if (res.ok) setFbStats(await res.json())
    } catch { /* best-effort */ }
    try {
      const r2 = await fetch(`/api/messages/faq/inbox?pageId=${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${t}` } })
      if (r2.ok) setInbox((await r2.json()).items ?? [])
    } catch { /* best-effort */ }
  }, [])

  const load = useCallback(async (t: string, pid: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/messages/faq?pageId=${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${t}` } })
      const d = await res.json()
      if (res.ok) { setCfg({ answers: {}, scheduleEntries: [], meetingTime: '', meetingLocation: '', scheduleSheetUrl: '', replyModel: 'standard', corrections: [], ...d.config }); setIntents(d.intents ?? []) }
      fetch('/api/messages/faq/sheet', { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.ok ? r.json() : null).then(d => { if (d?.email) setSaEmail(d.email) }).catch(() => {})
      loadFbStats(t, pid)
    } finally { setLoading(false) }
  }, [loadFbStats])

  // Firebase ID tokens expire after ~1h; always fetch a fresh one before an API
  // call (getIdToken auto-refreshes) so long-open pages don't hit "Invalid token".
  async function freshToken(): Promise<string> {
    return (await auth.currentUser?.getIdToken()) ?? token
  }

  async function syncSheet() {
    if (!cfg?.scheduleSheetUrl) return
    setSyncingSheet(true); setSheetErr('')
    try {
      const res = await fetch('/api/messages/faq/sheet', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, sheetUrl: cfg.scheduleSheetUrl }),
      })
      const d = await res.json()
      if (!res.ok) { setSheetErr(d.error ?? L('同步失敗', 'Sync failed')); return }
      setCfg(c => c ? { ...c, scheduleEntries: d.entries ?? [] } : c)
    } catch { setSheetErr(L('同步失敗', 'Sync failed')) }
    finally { setSyncingSheet(false) }
  }

  async function sendFeedback(rating: 'up' | 'down') {
    setFeedback(rating)
    if (rating === 'up') { void submitFeedback('up', ''); setFeedbackSent(true) }
  }
  async function submitFeedback(rating: 'up' | 'down', reason: string) {
    if (!previewResult) return
    try {
      const res = await fetch('/api/messages/faq/feedback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, message: previewAsked, reply: previewResult.text, intent: previewResult.intent, model: previewResult.model, action: previewResult.action, rating, reason }),
      })
      const d = await res.json().catch(() => ({}))
      // Keep client cfg in sync so a later "Save" doesn't clobber the new correction.
      if (d.addedCorrection && reason.trim()) {
        setCfg(c => c ? { ...c, corrections: [...(c.corrections ?? []), { text: reason.trim(), fromMessage: previewAsked, createdAt: new Date().toISOString() }] } : c)
      }
      loadFbStats(await freshToken(), pageId)
    } catch { /* best-effort */ }
  }

  async function runPreview() {
    if (!previewInput.trim()) return
    setPreviewing(true); setPreviewResult(null); setPreviewAsked(previewInput.trim())
    setFeedback(null); setFeedbackReason(''); setFeedbackSent(false)
    try {
      const res = await fetch('/api/messages/faq/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, message: previewInput }),
      })
      const d = await res.json()
      if (res.ok) setPreviewResult(d as PreviewResult)
      else setPreviewResult({ action: 'handoff', text: d.error ?? L('預覽失敗', 'Preview failed'), intent: 'other', groundingUsed: [] })
    } catch { setPreviewResult({ action: 'handoff', text: L('預覽失敗', 'Preview failed'), intent: 'other', groundingUsed: [] }) }
    finally { setPreviewing(false) }
  }

  function onCsvFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      // CSV → treat commas as cell separators so parseSchedule finds dates.
      const parsed = parseSchedule(String(reader.result ?? '').replace(/,/g, '\t'))
      if (parsed.length) setCfg(c => c ? { ...c, scheduleEntries: parsed } : c)
    }
    reader.readAsText(file)
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) { router.replace('/auth/login'); return }
      const t = await user.getIdToken(); setToken(t)
      const pid = typeof window !== 'undefined' ? (localStorage.getItem('selectedPageId') ?? '') : ''
      setPageId(pid)
      // Resolve the page name authoritatively from /api/pages (not the loosely-coupled
      // selectedPageName localStorage key, which some pages fail to keep in sync).
      const fallbackName = typeof window !== 'undefined' ? (localStorage.getItem('selectedPageName') ?? '') : ''
      setPageName(fallbackName)
      if (pid) {
        fetch('/api/pages', { headers: { Authorization: `Bearer ${t}` } })
          .then(r => r.ok ? r.json() : { pages: [] })
          .then(d => {
            const found = (d.pages ?? []).find((p: { pageId: string }) => p.pageId === pid)
            if (found?.pageName) setPageName(found.pageName)
          })
          .catch(() => { /* keep fallback name */ })
        load(t, pid)
      }
      else setLoading(false)
    })
    return unsub
  }, [router, load])

  function setAnswer(key: string, patch: Partial<Answer>) {
    setCfg(c => {
      if (!c) return c
      const prev = c.answers[key] ?? { answer: '', enabled: true }
      return { ...c, answers: { ...c.answers, [key]: { ...prev, ...patch } } }
    })
  }

  async function save() {
    if (!cfg) return
    setSaving(true); setSaved(false)
    try {
      const res = await fetch('/api/messages/faq', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, ...cfg }),
      })
      if (res.ok) { trackEvent('faq_saved', { enabled: cfg.enabled === true }); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    } finally { setSaving(false) }
  }

  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-300'

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/80 px-6 py-3 backdrop-blur">
        <button onClick={() => router.push('/dashboard/messages')} className="text-sm font-semibold text-gray-600 transition-colors hover:text-gray-800">← {L('返回私訊分析', 'Messages')}</button>
        <span className="text-gray-200">|</span>
        <h1 className="text-lg font-bold text-gray-900">{L('AI 自動回覆設定', 'AI auto-reply settings')}</h1>
        {pageName && <span className="truncate text-sm font-bold text-gray-700">· {pageName}</span>}
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {loading && <p className="text-sm text-gray-400">{L('讀取中…', 'Loading…')}</p>}
        {!loading && !pageId && <p className="text-sm text-gray-400">{L('請先在私訊分析頁選擇粉專。', 'Pick a page on the Messages page first.')}</p>}

        {!loading && cfg && (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex-1 space-y-6">
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs text-amber-700">
              {L('這裡設定的是 AI 客服 agent 的知識與答案。目前為「設定階段」——尚未實際自動回覆用戶（webhook 已接、發送在下一階段開啟）。',
                 'This configures the AI agent\'s knowledge and answers. Webhook is connected but replies are NOT sent yet (sending comes in the next phase).')}
            </div>

            {/* Inbox: real messages received via webhook (dry-run) */}
            {inbox.length > 0 && (
              <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-gray-700">{L('📥 收到的私訊（試跑，未發送）', '📥 Received DMs (dry-run, not sent)')}</p>
                <p className="mb-3 text-xs text-gray-400">{L('真實用戶私訊進來時，AI「會怎麼回」都記在這（目前不會真的送出）。', 'Shows what the AI WOULD reply to real inbound DMs — nothing is actually sent yet.')}</p>
                <ul className="max-h-80 space-y-2 overflow-y-auto">
                  {inbox.map((m, i) => (
                    <li key={i} className="rounded-lg border border-gray-100 p-3 text-xs">
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${m.platform === 'IG' ? 'bg-pink-50 text-pink-600' : 'bg-blue-50 text-blue-600'}`}>{m.platform}</span>
                        <span className="text-gray-700">{m.text}</span>
                        <span className="ml-auto text-[10px] text-gray-300">{m.createdAt.slice(5, 16).replace('T', ' ')}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-2 rounded bg-gray-50 p-2">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${m.action === 'reply' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {m.action === 'reply' ? L('會回', 'reply') : L('轉真人', 'handoff')}
                        </span>
                        <span className="text-gray-600">{m.reply}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-gray-300">{m.intent}{m.wouldSend ? L(' · 啟用後會自動送出', ' · would auto-send when enabled') : ''}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Global toggles */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <label className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">{L('啟用自動回覆（總開關）', 'Enable auto-reply (master)')}</span>
                <input type="checkbox" checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} className="h-4 w-4" />
              </label>
              <label className="mt-3 flex items-center justify-between">
                <span className="text-sm text-gray-600">{L('沒把握時轉真人（不亂答）', 'Hand off to human when unsure')}</span>
                <input type="checkbox" checked={cfg.humanHandoffEnabled} onChange={e => setCfg({ ...cfg, humanHandoffEnabled: e.target.checked })} className="h-4 w-4" />
              </label>
            </section>

            {/* Persona + knowledge */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">{L('語氣 / 角色', 'Tone / persona')}</p>
                <input className={field} value={cfg.persona} onChange={e => setCfg({ ...cfg, persona: e.target.value })} placeholder={L('例：親切、簡潔，用「我們」自稱', 'e.g. friendly, concise, use "we"')} />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">{L('補充知識（自由填寫）', 'Extra knowledge (free text)')}</p>
                <p className="mb-1 text-xs text-gray-400">{L('AI 生成回覆時會參考這些內容，避免亂編。', 'The AI grounds its replies on this to avoid making things up.')}</p>
                <textarea className={`${field} h-28 resize-y`} value={cfg.knowledgeBase} onChange={e => setCfg({ ...cfg, knowledgeBase: e.target.value })} placeholder={L('例：我們每週四晚上 7:30 在 XX 咖啡；來賓可免費體驗兩次…', 'e.g. We meet every Thu 7:30pm at XX Cafe; guests get 2 free trials…')} />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">{L('回覆品質', 'Reply quality')}</p>
                <div className="flex gap-2">
                  {([['standard', L('標準（快、省）', 'Standard')], ['advanced', L('進階（更細緻）', 'Advanced')]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setCfg({ ...cfg, replyModel: v })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${cfg.replyModel === v ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-400">{L('標準 = Claude Haiku；進階 = Claude Sonnet（品質更好、較慢較貴）', 'Standard = Claude Haiku; Advanced = Claude Sonnet')}</p>
              </div>
            </section>

            {/* Per-intent answers */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="mb-1 text-sm font-semibold text-gray-700">{L('各主題答案', 'Answers by topic')}</p>
              <p className="mb-3 text-xs text-gray-400">{L('對應 AI 的問題分類；填了 AI 就以此為準回答。', 'Maps to the AI\'s question categories; the AI answers based on these.')}</p>
              <div className="space-y-4">
                {intents.map(it => {
                  const a = cfg.answers[it.key] ?? { answer: '', enabled: true }
                  return (
                    <div key={it.key}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">{L(it.zh, it.en)}</span>
                        <label className="flex items-center gap-1 text-xs text-gray-400">
                          <input type="checkbox" checked={a.enabled} onChange={e => setAnswer(it.key, { enabled: e.target.checked })} className="h-3.5 w-3.5" />
                          {L('啟用', 'on')}
                        </label>
                      </div>
                      <textarea className={`${field} h-16 resize-y`} value={a.answer} onChange={e => setAnswer(it.key, { answer: e.target.value })} placeholder={L('（留空＝這題交給真人）', '(empty = hand off to human)')} />
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Meeting schedule */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-700">{L('例會排程', 'Meeting schedule')}</p>
                <p className="mt-1 text-xs text-gray-400">{L('貼上排程（可從 Google Sheet／Excel 直接複製）。AI 會用「今天之後最近一場」精準回答「下次例會」。', 'Paste your schedule (copy from Google Sheets/Excel). The AI answers "next meeting" using the nearest upcoming date.')}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">{L('固定時間', 'Time')}</p>
                  <input className={field} value={cfg.meetingTime} onChange={e => setCfg({ ...cfg, meetingTime: e.target.value })} placeholder={L('例：週四 19:30–21:30', 'e.g. Thu 19:30–21:30')} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">{L('地點', 'Location')}</p>
                  <input className={field} value={cfg.meetingLocation} onChange={e => setCfg({ ...cfg, meetingLocation: e.target.value })} placeholder={L('例：XX 咖啡 2 樓', 'e.g. XX Cafe 2F')} />
                </div>
              </div>
              {/* Import: Google Sheet */}
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-600">{L('① 從 Google Sheet 同步', '① Sync from Google Sheet')}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {L('先把你的表「共用（檢視者）」給下面這個服務帳號，ContentLoop 才讀得到：', 'Share your sheet (Viewer) with this service account so ContentLoop can read it:')}
                </p>
                {saEmail && (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-gray-600">{saEmail}</code>
                    <button onClick={() => navigator.clipboard?.writeText(saEmail)} className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:text-indigo-600">{L('複製', 'Copy')}</button>
                  </div>
                )}
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                  {L('※ 所有粉專管理者都是共用「這同一個」帳號——你只是把自己的表授予唯讀，不會影響其他資料。ContentLoop 只讀有被共用的表。（未來若改用專用服務帳號，此處會顯示新的 email，屆時再共用給新帳號即可。）',
                     '※ Every Page admin shares with this same account — you only grant read access to your own sheet. ContentLoop can only read sheets that were shared. (If we switch to a dedicated service account later, this email will change and you can re-share to the new one.)')}
                </p>
                <div className="mt-2 flex gap-2">
                  <input className={`${field} flex-1`} value={cfg.scheduleSheetUrl} onChange={e => setCfg({ ...cfg, scheduleSheetUrl: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
                  <button onClick={syncSheet} disabled={syncingSheet || !cfg.scheduleSheetUrl} className="shrink-0 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-60">
                    {syncingSheet ? L('同步中…', 'Syncing…') : L('同步', 'Sync')}
                  </button>
                </div>
                {sheetErr && <p className="mt-1 text-xs text-red-500">{sheetErr}</p>}
              </div>

              {/* Import: CSV upload */}
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-600">{L('② 上傳 CSV', '② Upload CSV')}</p>
                <p className="mt-1 mb-2 text-xs text-gray-400">{L('從 Excel／Sheet 另存 CSV 後上傳。', 'Export CSV from Excel/Sheets and upload.')}</p>
                <input type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) onCsvFile(f) }} className="text-xs text-gray-500" />
              </div>

              {/* Import: paste */}
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-600">{L('③ 或直接貼上', '③ Or paste')}</p>
                <textarea className={`${field} h-20 resize-y`} value={paste} onChange={e => setPaste(e.target.value)} placeholder={L('貼上含日期的內容，例：#683 2026/7/3 ⏎ #684 2026/7/17…', 'Paste rows/dates, e.g. #683 2026/7/3 ⏎ #684 2026/7/17…')} />
                <button
                  onClick={() => { const parsed = parseSchedule(paste); if (parsed.length) { setCfg({ ...cfg, scheduleEntries: parsed }); setPaste('') } }}
                  className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                >
                  {L('解析日期', 'Parse dates')}
                </button>
              </div>
              {cfg.scheduleEntries.length > 0 && (() => {
                const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
                const next = nextMeeting(cfg.scheduleEntries, todayIso)
                return (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="mb-2 text-xs text-gray-500">{L(`解析到 ${cfg.scheduleEntries.length} 場`, `${cfg.scheduleEntries.length} parsed`)}{next && <span className="ml-2 font-semibold text-indigo-600">{L('下次：', 'Next: ')}{next.date} {next.label}</span>}</p>
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {cfg.scheduleEntries.map((e, i) => (
                        <div key={i} className={`flex items-center gap-2 text-xs ${next && e.date === next.date ? 'font-semibold text-indigo-600' : 'text-gray-500'}`}>
                          <span className="w-24 shrink-0">{e.date}</span>
                          <span className="truncate">{e.label}</span>
                          <button onClick={() => setCfg({ ...cfg, scheduleEntries: cfg.scheduleEntries.filter((_, j) => j !== i) })} className="ml-auto text-gray-300 hover:text-red-500">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </section>

            {/* Fallback */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="mb-1 text-sm font-semibold text-gray-700">{L('無法回答時的訊息', 'Fallback message')}</p>
              <textarea className={`${field} h-16 resize-y`} value={cfg.fallbackMessage} onChange={e => setCfg({ ...cfg, fallbackMessage: e.target.value })} />
            </section>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-60">
                {saving ? L('儲存中…', 'Saving…') : L('儲存設定', 'Save')}
              </button>
              {saved && <span className="text-sm text-green-600">{L('已儲存 ✓', 'Saved ✓')}</span>}
            </div>

            </div>

            {/* Right: chat-style dry-run preview + feedback insights (sticky) */}
            <aside className="space-y-4 lg:sticky lg:top-20 lg:w-96 lg:shrink-0">
              <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" style={{ height: 'calc(100vh - 380px)', minHeight: 360, maxHeight: 520 }}>
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-800">{L('🧪 試回覆', '🧪 Test reply')}</p>
                  <p className="text-[11px] leading-relaxed text-gray-400">{L('僅內部測試（不會真的發送）。先把左側的 agent 知識與答案填完，資訊越充分，AI 越知道怎麼回；填完按「儲存設定」再測。', 'Internal test only (not sent). Fill in the agent knowledge & answers on the left first — the more complete, the better the AI replies. Save settings, then test.')}</p>
                </div>

                {/* Conversation area */}
                <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {!previewResult && !previewing && (
                    <p className="mt-10 text-center text-xs text-gray-400">{L('在下面輸入用戶可能問的問題，看看 AI 會怎麼回 👇', 'Type a question below to see the AI reply 👇')}</p>
                  )}
                  {previewAsked && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-500 px-3 py-2 text-sm text-white">{previewAsked}</div>
                    </div>
                  )}
                  {previewing && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-bl-sm border border-gray-100 bg-white px-3 py-2 text-sm text-gray-400">{L('輸入中…', 'typing…')}</div>
                    </div>
                  )}
                  {previewResult && (
                    <div className="flex flex-col items-start">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-gray-100 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm">{previewResult.text}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1 text-[10px]">
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${previewResult.action === 'reply' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {previewResult.action === 'reply' ? L('AI 回覆', 'AI reply') : L('轉真人', 'Hand off')}
                        </span>
                        <span className="text-gray-400">{previewResult.intent}</span>
                        {previewResult.model && <span className="text-gray-300">{previewResult.model.includes('sonnet') ? 'Sonnet' : 'Haiku'}</span>}
                        {previewResult.groundingUsed.length > 0 && <span className="text-gray-300">· {previewResult.groundingUsed.join(', ')}</span>}
                        {/* feedback */}
                        <span className="ml-1 flex items-center gap-1">
                          <button onClick={() => sendFeedback('up')} className={`rounded px-1 ${feedback === 'up' ? 'text-green-600' : 'text-gray-300 hover:text-green-500'}`} aria-label="good">👍</button>
                          <button onClick={() => sendFeedback('down')} className={`rounded px-1 ${feedback === 'down' ? 'text-red-500' : 'text-gray-300 hover:text-red-500'}`} aria-label="bad">👎</button>
                        </span>
                      </div>
                      {feedbackSent && (
                        <p className="mt-1 pl-1 text-[10px] text-gray-400">
                          {feedback === 'down' && feedbackReason.trim()
                            ? L('已加入知識庫，下次同問題會參考 ✓', 'Added to knowledge — next time it\'ll use this ✓')
                            : L('感謝回饋 🙏', 'Thanks 🙏')}
                        </p>
                      )}
                      {feedback === 'down' && !feedbackSent && (
                        <div className="mt-1 flex w-full items-center gap-1 pl-1">
                          <input
                            value={feedbackReason}
                            onChange={e => setFeedbackReason(e.target.value)}
                            placeholder={L('哪裡不好？（可選）', 'What was wrong? (optional)')}
                            className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] outline-none focus:border-red-200"
                          />
                          <button onClick={() => { void submitFeedback('down', feedbackReason); setFeedbackSent(true) }} className="rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white">{L('送出', 'Send')}</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Messenger-style input */}
                <div className="flex items-center gap-2 border-t border-gray-100 bg-white p-3">
                  <input
                    value={previewInput}
                    onChange={e => setPreviewInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') runPreview() }}
                    placeholder={L('輸入訊息…', 'Type a message…')}
                    className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700 outline-none focus:border-indigo-300 focus:bg-white"
                  />
                  <button onClick={runPreview} disabled={previewing || !previewInput.trim()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40" aria-label="send">
                    ➤
                  </button>
                </div>
              </div>

              {/* Learning & feedback (T1 corrections + T2 insights) — under test-reply */}
              {((cfg.corrections?.length ?? 0) > 0 || (fbStats?.total ?? 0) > 0) && (
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-gray-800">{L('🧠 學習與回饋', '🧠 Learning & feedback')}</p>
                  <p className="mb-3 text-[11px] text-gray-400">{L('按 👎 寫下正確資訊 → AI 下次優先參考。', 'Downvote + correct → the AI uses it next time.')}</p>

                  {/* Corrections the AI learned */}
                  {(cfg.corrections?.length ?? 0) > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 text-[11px] font-medium text-gray-500">{L(`AI 學到的更正（${cfg.corrections.length}）`, `Learned corrections (${cfg.corrections.length})`)}</p>
                      <ul className="max-h-36 space-y-1 overflow-y-auto">
                        {cfg.corrections.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5 rounded-lg border border-gray-100 bg-gray-50 p-2 text-[11px]">
                            <span className="mt-0.5 text-indigo-400">✎</span>
                            <span className="flex-1 text-gray-700">{c.text}</span>
                            <button onClick={() => setCfg({ ...cfg, corrections: cfg.corrections.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-500">✕</button>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[10px] text-gray-400">{L('※ 刪除後記得按「儲存設定」。', '※ Save after removing.')}</p>
                    </div>
                  )}

                  {/* Feedback stats */}
                  {fbStats && fbStats.total > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="mb-2 flex items-center gap-3 text-sm">
                        <span className="text-green-600">👍 {fbStats.up}</span>
                        <span className="text-red-500">👎 {fbStats.down}</span>
                        <span className="text-[11px] text-gray-400">{L('共', 'total')} {fbStats.total}</span>
                        {fbStats.topDownIntents.slice(0, 3).map(t => (
                          <span key={t.intent} className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-500">{t.intent}·{t.down}</span>
                        ))}
                      </div>
                      {fbStats.recentDown.length > 0 && (
                        <ul className="max-h-36 space-y-1 overflow-y-auto">
                          {fbStats.recentDown.slice(0, 8).map((r, i) => (
                            <li key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-[11px]">
                              <p className="text-gray-700">Q：{r.message || '—'}</p>
                              {r.reason && <p className="mt-0.5 text-indigo-500">{L('更正：', 'fix: ')}{r.reason}</p>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </main>
  )
}
