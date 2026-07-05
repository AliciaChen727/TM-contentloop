'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { parseSchedule, nextMeeting, type ParsedEntry } from '@/lib/messages/parseSchedule'

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
}

export default function FaqSettingsPage() {
  const router = useRouter()
  const { L } = useLang()
  const [token, setToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [intents, setIntents] = useState<IntentMeta[]>([])
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [paste, setPaste] = useState('')
  const [saEmail, setSaEmail] = useState('')
  const [syncingSheet, setSyncingSheet] = useState(false)
  const [sheetErr, setSheetErr] = useState('')

  const load = useCallback(async (t: string, pid: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/messages/faq?pageId=${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${t}` } })
      const d = await res.json()
      if (res.ok) { setCfg({ answers: {}, scheduleEntries: [], meetingTime: '', meetingLocation: '', scheduleSheetUrl: '', ...d.config }); setIntents(d.intents ?? []) }
      fetch('/api/messages/faq/sheet', { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.ok ? r.json() : null).then(d => { if (d?.email) setSaEmail(d.email) }).catch(() => {})
    } finally { setLoading(false) }
  }, [])

  async function syncSheet() {
    if (!cfg?.scheduleSheetUrl) return
    setSyncingSheet(true); setSheetErr('')
    try {
      const res = await fetch('/api/messages/faq/sheet', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, sheetUrl: cfg.scheduleSheetUrl }),
      })
      const d = await res.json()
      if (!res.ok) { setSheetErr(d.error ?? L('同步失敗', 'Sync failed')); return }
      setCfg(c => c ? { ...c, scheduleEntries: d.entries ?? [] } : c)
    } catch { setSheetErr(L('同步失敗', 'Sync failed')) }
    finally { setSyncingSheet(false) }
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
      if (pid) load(t, pid)
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, ...cfg }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    } finally { setSaving(false) }
  }

  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-300'

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/80 px-6 py-3 backdrop-blur">
        <button onClick={() => router.push('/dashboard/messages')} className="text-sm text-gray-400 transition-colors hover:text-gray-700">← {L('返回私訊分析', 'Messages')}</button>
        <span className="text-gray-200">|</span>
        <h1 className="text-lg font-bold text-gray-900">{L('AI 自動回覆設定', 'AI auto-reply settings')}</h1>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {loading && <p className="text-sm text-gray-400">{L('讀取中…', 'Loading…')}</p>}
        {!loading && !pageId && <p className="text-sm text-gray-400">{L('請先在私訊分析頁選擇粉專。', 'Pick a page on the Messages page first.')}</p>}

        {!loading && cfg && (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs text-amber-700">
              {L('這裡設定的是 AI 客服 agent 的知識與答案。目前為「設定階段」——尚未實際自動回覆用戶（webhook／發送在下一階段開啟）。',
                 'This configures the AI agent\'s knowledge and answers. It is not sending replies yet (webhook/sending comes in the next phase).')}
            </div>

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
        )}
      </div>
    </main>
  )
}
