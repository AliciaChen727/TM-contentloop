'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Lang = 'zh' | 'en'

const COPY = {
  zh: {
    nav_login: '登入',
    hero_badge: 'AI 廣告與內容成效儀表板',
    hero_title: ['讓數據替你', '說話', '，', '把優化交給 ', 'AI'],
    hero_desc:
      'ContentLoop 自動抓取你 FB 粉專與 IG 的貼文、廣告與限動成效，用 AI 診斷問題、生成洞察報告、提供可執行建議——讓你少花時間對數字，多花時間做對的內容。',
    hero_cta1: '立即登入開始 →',
    hero_cta2: '看看功能',
    hero_note: '支援 Google / Facebook 登入 · 資料只屬於你',
    features_title: '你需要的，一個平台搞定',
    features_sub: '從抓資料到下決策，整條優化迴圈都在這裡。',
    steps_title: '三步開始',
    steps_sub: '登入後幾分鐘內就能看到你的第一份成效儀表板。',
    cta_title: '準備好讓內容自己進步了嗎？',
    cta_sub: '登入連接你的粉專，剩下的交給 ContentLoop。',
    cta_btn: '立即登入開始 →',
    footer_login: '登入',
    footer_privacy: '隱私權政策',
    footer_deletion: '資料刪除',
  },
  en: {
    nav_login: 'Log in',
    hero_badge: 'AI Ad & Content Performance Dashboard',
    hero_title: ['Let your data ', 'speak', ', ', 'and leave optimization to ', 'AI'],
    hero_desc:
      'ContentLoop automatically pulls performance data from your FB Page and IG posts, ads, and stories—then uses AI to diagnose issues, generate insight reports, and deliver actionable advice. Spend less time crunching numbers, more time creating the right content.',
    hero_cta1: 'Log in to start →',
    hero_cta2: 'See features',
    hero_note: 'Sign in with Google / Facebook · Your data stays yours',
    features_title: 'Everything you need, in one platform',
    features_sub: 'From data collection to decisions—the whole optimization loop lives here.',
    steps_title: 'Get started in 3 steps',
    steps_sub: 'See your first performance dashboard within minutes of logging in.',
    cta_title: 'Ready to let your content improve itself?',
    cta_sub: 'Log in, connect your Page, and leave the rest to ContentLoop.',
    cta_btn: 'Log in to start →',
    footer_login: 'Log in',
    footer_privacy: 'Privacy Policy',
    footer_deletion: 'Data Deletion',
  },
} as const

const FEATURES: Record<Lang, { icon: string; title: string; desc: string }[]> = {
  zh: [
    { icon: '📊', title: '一站看完 FB + IG 成效', desc: '透過 Meta 官方授權，自動定時抓取粉專貼文、廣告與限動成效，存進你自己的資料庫，再用清楚的儀表板呈現。不必再開七八個分頁手動對數字。' },
    { icon: '🩺', title: 'AI 診斷引擎', desc: '依你的廣告目標（轉換／觸及／互動）自動比對指標門檻，標出 CTR 過低、CPA 過高、frequency 疲乏等問題，並給出可執行的調整建議——不是空泛的「再加油」。' },
    { icon: '🤖', title: 'AI Sidekick 投手助理', desc: '隨時對話式提問「這支廣告為什麼成效差？」「下週預算怎麼配？」，Sidekick 會帶著你當下的真實數據回答，並能直接生成素材文案與圖片。' },
    { icon: '📈', title: '自動洞察報告', desc: '一鍵生成圖文並茂的成效報告，含同業 benchmark 對照、最佳貼文分析、廣告 A/B 結果與下一步建議，會議前直接拿去報告。' },
    { icon: '🔔', title: '異常即時通知', desc: '站內通知中心紅點 + 排程 email 告警，廣告成效掉到門檻以下第一時間就知道，不必等到月底結算才發現預算燒光。' },
    { icon: '🏷️', title: '素材生成 × 品牌素材庫', desc: 'AI 依品牌調性生成貼文圖文，並能把你上傳的 logo 等品牌素材，在生圖時像素級精準疊上，或一鍵帶進 Canva 繼續編輯。' },
  ],
  en: [
    { icon: '📊', title: 'FB + IG performance, all in one', desc: "With official Meta authorization, ContentLoop automatically and regularly pulls your Page posts, ads, and stories into your own database, then presents them in a clear dashboard. No more juggling seven tabs to reconcile numbers by hand." },
    { icon: '🩺', title: 'AI Diagnosis Engine', desc: 'Based on your ad objective (conversions / reach / engagement), it compares metrics against thresholds, flags issues like low CTR, high CPA, or frequency fatigue, and gives actionable fixes—not vague "keep it up" advice.' },
    { icon: '🤖', title: 'AI Sidekick', desc: 'Ask anytime: "Why is this ad underperforming?" "How should I allocate next week\'s budget?" Sidekick answers using your real-time data, and can generate ad copy and images on the spot.' },
    { icon: '📈', title: 'Automated Insight Reports', desc: 'Generate a rich performance report in one click—with industry benchmarks, top-post analysis, ad A/B results, and next steps. Bring it straight to your meeting.' },
    { icon: '🔔', title: 'Real-time Anomaly Alerts', desc: 'In-app notification badges plus scheduled email alerts let you know the moment ad performance drops below threshold—no waiting until month-end to find the budget burned.' },
    { icon: '🏷️', title: 'Creative Gen × Brand Asset Library', desc: 'AI generates on-brand post visuals and copy, and can pixel-perfectly overlay your uploaded brand assets (like a logo) at generation time, or push them into Canva for further editing.' },
  ],
}

const STEPS: Record<Lang, { n: string; title: string; desc: string }[]> = {
  zh: [
    { n: '1', title: '連接 Meta 粉專', desc: '用 Google 或 Facebook 登入，授權你管理的 FB 粉專與連動的 IG 商業帳號。' },
    { n: '2', title: '自動抓取成效', desc: '系統定時同步貼文、廣告、限動數據，建立你專屬的成效資料庫。' },
    { n: '3', title: '看診斷、發報告、優化', desc: '從儀表板看診斷建議、生成洞察報告、用 AI Sidekick 持續優化內容與廣告。' },
  ],
  en: [
    { n: '1', title: 'Connect your Meta Page', desc: 'Sign in with Google or Facebook and authorize the FB Pages you manage along with the linked IG business account.' },
    { n: '2', title: 'Auto-sync performance', desc: 'The system regularly syncs your posts, ads, and stories to build a performance database that\'s exclusively yours.' },
    { n: '3', title: 'Diagnose, report, optimize', desc: 'View diagnoses on the dashboard, generate insight reports, and keep optimizing content and ads with AI Sidekick.' },
  ],
}

export default function HomeClient({ initialLang }: { initialLang: Lang }) {
  // 初始語言由 server 依 URL ?lang= 決定（SEO：HTML 直接是對應語言）。
  const [lang, setLang] = useState<Lang>(initialLang)
  const t = COPY[lang]

  // 掛載後決定最終語言。優先序：URL 參數 > localStorage > 預設。
  useEffect(() => {
    const urlLang = new URLSearchParams(window.location.search).get('lang')
    if (urlLang === 'en' || urlLang === 'zh') {
      setLang(urlLang)
      localStorage.setItem('cl_lang', urlLang)
    } else {
      const saved = localStorage.getItem('cl_lang')
      if (saved === 'en' || saved === 'zh') setLang(saved)
    }
  }, [])

  // 同步 <html lang> 供爬蟲 / 輔助技術判讀。
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'
  }, [lang])

  function changeLang(next: Lang) {
    setLang(next)
    localStorage.setItem('cl_lang', next)
    // 把語言反映到網址列，方便直接複製分享（不重新導頁）。
    const url = new URL(window.location.href)
    url.searchParams.set('lang', next)
    window.history.replaceState({}, '', url)
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-[family-name:var(--font-geist-sans)]">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">
            Content<span className="text-blue-600">Loop</span>
          </span>
          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <div className="flex items-center rounded-full border border-gray-200 p-0.5 text-xs font-semibold">
              <button
                onClick={() => changeLang('zh')}
                className={`rounded-full px-3 py-1 transition ${lang === 'zh' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                aria-pressed={lang === 'zh'}
              >
                中
              </button>
              <button
                onClick={() => changeLang('en')}
                className={`rounded-full px-3 py-1 transition ${lang === 'en' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                aria-pressed={lang === 'en'}
              >
                EN
              </button>
            </div>
            <Link
              href="/auth/login"
              className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              {t.nav_login}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-100/60 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-6 pt-20 pb-16 text-center sm:pt-28">
          <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-xs font-medium text-blue-700">
            {t.hero_badge}
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t.hero_title[0]}
            <span className="text-blue-600">{t.hero_title[1]}</span>
            {t.hero_title[2]}
            <br className="hidden sm:block" />
            {t.hero_title[3]}
            <span className="text-blue-600">{t.hero_title[4]}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-600">{t.hero_desc}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/login"
              className="w-full rounded-full bg-blue-600 px-8 py-3 text-center text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 sm:w-auto"
            >
              {t.hero_cta1}
            </Link>
            <a
              href="#features"
              className="w-full rounded-full border border-gray-200 px-8 py-3 text-center text-base font-semibold text-gray-700 transition hover:bg-gray-50 sm:w-auto"
            >
              {t.hero_cta2}
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-400">{t.hero_note}</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t.features_title}</h2>
          <p className="mt-3 text-gray-600">{t.features_sub}</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES[lang].map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-gray-100 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t.steps_title}</h2>
            <p className="mt-3 text-gray-600">{t.steps_sub}</p>
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {STEPS[lang].map((s) => (
              <div key={s.n} className="relative text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
                  {s.n}
                </div>
                <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.cta_title}</h2>
        <p className="mx-auto mt-4 max-w-lg text-gray-600">{t.cta_sub}</p>
        <Link
          href="/auth/login"
          className="mt-8 inline-block rounded-full bg-blue-600 px-10 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
        >
          {t.cta_btn}
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500 sm:flex-row">
          <span className="font-bold text-gray-700">
            Content<span className="text-blue-600">Loop</span>
          </span>
          <div className="flex gap-6">
            <Link href="/auth/login" className="hover:text-gray-900">{t.footer_login}</Link>
            <Link href="/privacy" className="hover:text-gray-900">{t.footer_privacy}</Link>
            <Link href="/data-deletion" className="hover:text-gray-900">{t.footer_deletion}</Link>
          </div>
          <span className="text-xs text-gray-400">© {new Date().getFullYear()} ContentLoop</span>
        </div>
      </footer>
    </div>
  )
}
