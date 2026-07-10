'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { freshIdToken } from '@/lib/firebase/client'
import type { Industry } from '@/lib/profile-types'
import {
  COPY_GOALS, TONE_PRESETS, fieldsForIndustry, type CopyGoal,
} from '@/lib/content/captionSettings'

// Settings panel shown before AI caption generation. Grounds the copy in goal +
// tone + language + required facts (industry-customized) + a goal-aligned CTA.
const PLAT_LABEL: Record<string, string> = { fb: 'Facebook', ig: 'Instagram', th: 'Threads' }

export function CaptionSettings({ pageId, idToken, targets, mediaType, seed, onGenerated, onClose }: {
  pageId: string
  idToken: string
  targets: string[]
  mediaType: string
  seed: string
  onGenerated: (result: { shared?: string; perPlatform?: Record<string, string> }) => void
  onClose: () => void
}) {
  const { L, lang } = useLang()
  const [industry, setIndustry] = useState<Industry | null>(null)
  const [goal, setGoal] = useState<CopyGoal>('signups')
  const [tone, setTone] = useState(L(TONE_PRESETS[0].zh, TONE_PRESETS[0].en))
  const [language, setLanguage] = useState<'zh' | 'en'>(lang === 'en' ? 'en' : 'zh')
  const [cta, setCta] = useState('')
  const [info, setInfo] = useState<Record<string, string>>({})
  const [useHistory, setUseHistory] = useState(true)
  const [perPlatform, setPerPlatform] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const multiPlatform = targets.filter(t => ['fb', 'ig', 'th'].includes(t)).length > 1

  useEffect(() => {
    freshIdToken().then(t => fetch(`/api/pages/${pageId}/profile`, { headers: { Authorization: `Bearer ${t || idToken}` } }))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.industry) setIndustry(d.industry as Industry) })
      .catch(() => {})
  }, [pageId, idToken])

  const goalDef = COPY_GOALS.find(g => g.key === goal)!
  const ctaOptions = language === 'en' ? goalDef.ctasEn : goalDef.ctas
  const fields = fieldsForIndustry(industry)
  const zhOut = language === 'zh'

  async function generate() {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/ai/caption', {
        method: 'POST', headers: { Authorization: `Bearer ${(await freshIdToken()) || idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId, targets, mediaType, seed, lang: language, useHistory,
          perPlatform: perPlatform && multiPlatform,
          settings: {
            tone, goal: zhOut ? goalDef.zh : goalDef.en, language, cta,
            info: Object.fromEntries(fields.map(f => [zhOut ? f.zh : f.en, info[f.key] ?? ''])),
          },
        }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error === 'NO_API_KEY' ? L('尚未設定 AI 金鑰', 'No AI key set') : (d.error ?? L('生成失敗', 'Failed'))); return }
      if (d.captions) onGenerated({ perPlatform: d.captions as Record<string, string> })
      else onGenerated({ shared: d.caption ?? '' })
    } catch { setErr(L('生成失敗', 'Generation failed')) } finally { setBusy(false) }
  }

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm font-semibold ${active ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500'}`

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-gray-900">✨ {L('AI 文案設定', 'AI caption settings')}</h2>
        <p className="mb-4 text-xs text-gray-500">{L('設定後再生成，讓文案有依據。', 'Set these first so the copy is grounded.')}</p>

        {/* 發布平台 */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">{L('發布平台', 'Platforms')}</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {targets.length === 0
            ? <span className="text-xs text-gray-400">{L('請先在草稿選擇平台', 'Pick platforms in the composer first')}</span>
            : targets.map(t => <span key={t} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700">{PLAT_LABEL[t] ?? t}</span>)}
        </div>
        {multiPlatform && (
          <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
            <input type="checkbox" checked={perPlatform} onChange={e => setPerPlatform(e.target.checked)} className="mt-0.5 h-4 w-4 accent-purple-600" />
            <span>
              <span className="block text-sm font-semibold text-gray-700">🎯 {L('依平台屬性各自產生文案', 'Tailor copy per platform')}</span>
              <span className="block text-xs text-gray-400">{L('FB 可較完整、IG 視覺精煉、Threads 口語精簡——各平台不同文案（可再各自編輯）。', 'FB fuller, IG punchy, Threads conversational — different copy each (editable after).')}</span>
            </span>
          </label>
        )}

        {/* 語言 */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">{L('語言', 'Language')}</label>
        <div className="mb-4 flex gap-2">
          {/* Switching language clears the CTA — its options are language-specific,
              so a stale opposite-language CTA won't leak into the output. */}
          <button onClick={() => { setLanguage('zh'); setCta('') }} className={chip(language === 'zh')}>{L('中文', 'Chinese')}</button>
          <button onClick={() => { setLanguage('en'); setCta('') }} className={chip(language === 'en')}>{L('英文', 'English')}</button>
        </div>

        {/* 文案目標 */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">{L('文案目標', 'Copy goal')}</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {COPY_GOALS.map(g => (
            <button key={g.key} onClick={() => { setGoal(g.key); setCta('') }} className={chip(goal === g.key)}>{L(g.zh, g.en)}</button>
          ))}
        </div>

        {/* 語氣風格 */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">{L('語氣風格', 'Tone')}</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {TONE_PRESETS.map(t => {
            const val = L(t.zh, t.en)
            return <button key={t.zh} onClick={() => setTone(val)} className={chip(tone === val)}>{val}</button>
          })}
        </div>
        <input value={tone} onChange={e => setTone(e.target.value)} placeholder={L('或自訂語氣…', 'or custom tone…')}
          className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />

        {/* CTA（與目標一致） */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">
          {L('CTA 行動方向', 'CTA direction')}
          <span className="ml-1 text-xs font-normal text-gray-400">{L('（參考方向，AI 會據此寫出自然呼籲句，非照抄）', '(a direction; AI writes its own CTA, not verbatim)')}</span>
        </label>
        <div className="mb-2 flex flex-wrap gap-2">
          {ctaOptions.map(c => <button key={c} onClick={() => setCta(c)} className={chip(cta === c)}>{c}</button>)}
        </div>
        <input value={cta} onChange={e => setCta(e.target.value)} placeholder={L('或自訂 CTA…', 'or custom CTA…')}
          className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />

        {/* 必要資訊（依產業） */}
        <label className="mb-1 block text-sm font-semibold text-gray-700">
          {L('必要資訊', 'Required info')}
          <span className="ml-1 text-xs font-normal text-gray-400">{L('（依產業，AI 只會用你填的，不捏造）', '(by industry; AI uses only what you fill)')}</span>
        </label>
        <div className="mb-4 space-y-2">
          {fields.map(f => (
            <div key={f.key}>
              <span className="mb-0.5 block text-xs font-medium text-gray-500">{L(f.zh, f.en)}</span>
              <textarea value={info[f.key] ?? ''} onChange={e => setInfo(v => ({ ...v, [f.key]: e.target.value }))}
                rows={2}
                placeholder={f.placeholder ? (lang === 'en' && f.placeholderEn ? f.placeholderEn : f.placeholder) : L(f.zh, f.en)}
                className="max-h-40 min-h-[2.5rem] w-full resize-y overflow-y-auto rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
            </div>
          ))}
        </div>

        {/* 參考歷史貼文 */}
        <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
          <input type="checkbox" checked={useHistory} onChange={e => setUseHistory(e.target.checked)} className="mt-0.5 h-4 w-4 accent-purple-600" />
          <span>
            <span className="block text-sm font-semibold text-gray-700">📚 {L('參考我成效最好的歷史貼文', 'Learn from my best past posts')}</span>
            <span className="block text-xs text-gray-400">{L('讓 AI 學這個粉專有效貼文的口吻（只讀本粉專、不照抄）。想要全新風格可關閉。', "AI mimics the voice of this page's top posts (this page only; no copying). Turn off for a fresh style.")}</span>
          </span>
        </label>

        {err && <p className="mb-3 text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600">{L('取消', 'Cancel')}</button>
          <button disabled={busy} onClick={generate} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? L('生成中…', 'Generating…') : `✨ ${L('生成文案', 'Generate')}`}
          </button>
        </div>
      </div>
    </div>
  )
}
