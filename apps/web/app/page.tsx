import Link from 'next/link'

const FEATURES = [
  {
    icon: '📊',
    title: '一站看完 FB + IG 成效',
    desc: '透過 Meta 官方授權，自動定時抓取粉專貼文、廣告與限動成效，存進你自己的資料庫，再用清楚的儀表板呈現。不必再開七八個分頁手動對數字。',
  },
  {
    icon: '🩺',
    title: 'AI 診斷引擎',
    desc: '依你的廣告目標（轉換／觸及／互動）自動比對指標門檻，標出 CTR 過低、CPA 過高、frequency 疲乏等問題，並給出可執行的調整建議——不是空泛的「再加油」。',
  },
  {
    icon: '🤖',
    title: 'AI Sidekick 投手助理',
    desc: '隨時對話式提問「這支廣告為什麼成效差？」「下週預算怎麼配？」，Sidekick 會帶著你當下的真實數據回答，並能直接生成素材文案與圖片。',
  },
  {
    icon: '📈',
    title: '自動洞察報告',
    desc: '一鍵生成圖文並茂的成效報告，含同業 benchmark 對照、最佳貼文分析、廣告 A/B 結果與下一步建議，會議前直接拿去報告。',
  },
  {
    icon: '🔔',
    title: '異常即時通知',
    desc: '站內通知中心紅點 + 排程 email 告警，廣告成效掉到門檻以下第一時間就知道，不必等到月底結算才發現預算燒光。',
  },
  {
    icon: '🏷️',
    title: '素材生成 × 品牌素材庫',
    desc: 'AI 依品牌調性生成貼文圖文，並能把你上傳的 logo 等品牌素材，在生圖時像素級精準疊上，或一鍵帶進 Canva 繼續編輯。',
  },
]

const STEPS = [
  { n: '1', title: '連接 Meta 粉專', desc: '用 Google 或 Facebook 登入，授權你管理的 FB 粉專與連動的 IG 商業帳號。' },
  { n: '2', title: '自動抓取成效', desc: '系統定時同步貼文、廣告、限動數據，建立你專屬的成效資料庫。' },
  { n: '3', title: '看診斷、發報告、優化', desc: '從儀表板看診斷建議、生成洞察報告、用 AI Sidekick 持續優化內容與廣告。' },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-[family-name:var(--font-geist-sans)]">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">
            Content<span className="text-blue-600">Loop</span>
          </span>
          <Link
            href="/auth/login"
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            登入
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-100/60 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-6 pt-20 pb-16 text-center sm:pt-28">
          <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-xs font-medium text-blue-700">
            AI 廣告與內容成效儀表板
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            讓數據替你<span className="text-blue-600">說話</span>，
            <br className="hidden sm:block" />
            把優化交給 <span className="text-blue-600">AI</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-600">
            ContentLoop 自動抓取你 FB 粉專與 IG 的貼文、廣告與限動成效，
            用 AI 診斷問題、生成洞察報告、提供可執行建議——
            讓你少花時間對數字，多花時間做對的內容。
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/login"
              className="w-full rounded-full bg-blue-600 px-8 py-3 text-center text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 sm:w-auto"
            >
              立即登入開始 →
            </Link>
            <a
              href="#features"
              className="w-full rounded-full border border-gray-200 px-8 py-3 text-center text-base font-semibold text-gray-700 transition hover:bg-gray-50 sm:w-auto"
            >
              看看功能
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-400">支援 Google / Facebook 登入 · 資料只屬於你</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">你需要的，一個平台搞定</h2>
          <p className="mt-3 text-gray-600">從抓資料到下決策，整條優化迴圈都在這裡。</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
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
            <h2 className="text-3xl font-bold tracking-tight">三步開始</h2>
            <p className="mt-3 text-gray-600">登入後幾分鐘內就能看到你的第一份成效儀表板。</p>
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
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
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">準備好讓內容自己進步了嗎？</h2>
        <p className="mx-auto mt-4 max-w-lg text-gray-600">
          登入連接你的粉專，剩下的交給 ContentLoop。
        </p>
        <Link
          href="/auth/login"
          className="mt-8 inline-block rounded-full bg-blue-600 px-10 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
        >
          立即登入開始 →
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500 sm:flex-row">
          <span className="font-bold text-gray-700">
            Content<span className="text-blue-600">Loop</span>
          </span>
          <div className="flex gap-6">
            <Link href="/auth/login" className="hover:text-gray-900">登入</Link>
            <Link href="/privacy" className="hover:text-gray-900">隱私權政策</Link>
            <Link href="/data-deletion" className="hover:text-gray-900">資料刪除</Link>
          </div>
          <span className="text-xs text-gray-400">© {new Date().getFullYear()} ContentLoop</span>
        </div>
      </footer>
    </div>
  )
}
