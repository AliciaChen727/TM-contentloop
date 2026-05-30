'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

type SaveState = 'idle' | 'saving' | 'ok' | 'error'
type Language = 'zh-TW' | 'en'
type Tier = 'free' | 'pro'

interface UsageData {
  tier: Tier
  imageCount: number
  imageLimit: number
  videoSeconds: number
  videoSecondsLimit: number
  imageCostUsd: number
  videoCostUsd: number
}

function ProgressBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit === 0 ? 0 : Math.min(100, (used / limit) * 100)
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#3B6FD4'
  return (
    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const [idToken, setIdToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [language, setLanguage] = useState<Language>('zh-TW')
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [adGoal, setAdGoal] = useState<'clicks' | 'conversion' | 'reach' | 'event' | ''>('')
  const [industry, setIndustry] = useState<'ecommerce' | 'education' | 'event' | 'personal_brand' | 'other' | ''>('')
  const [industryOther, setIndustryOther] = useState('')
  const [goalSaveState, setGoalSaveState] = useState<SaveState>('idle')
  const [brandName, setBrandName] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [brandSaveState, setBrandSaveState] = useState<SaveState>('idle')
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null)
  const [canvaMsg, setCanvaMsg] = useState<'connected' | 'error' | null>(null)

  // Fallback path only: if the OAuth flow ran full-page (popup blocked), the
  // callback redirects here with ?canva=... — read it once, then strip it so
  // back/refresh doesn't replay a stale result.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('canva')
    if (param === 'connected' || param === 'error') {
      setCanvaMsg(param)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Preferred path: the OAuth flow runs in a popup so canva.com never enters the
  // main window's history (fixes "back button returns to Canva consent"). The
  // callback posts the result back here and closes itself.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data as { type?: string; status?: 'connected' | 'error' }
      if (data?.type !== 'canva-result') return
      if (data.status === 'connected') {
        setCanvaMsg('connected')
        setCanvaConnected(true)
      } else if (data.status === 'error') {
        setCanvaMsg('error')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function connectCanva() {
    if (!idToken) return
    const url = `/api/auth/canva/authorize?idToken=${encodeURIComponent(idToken)}`
    const popup = window.open(url, 'canva-oauth', 'width=600,height=760')
    // Popup blocked → fall back to full-page navigation (callback redirects back)
    if (!popup) window.location.href = url
  }

  const needsOtherText = industry === 'other'
  const goalReady = !!adGoal && !!industry && (!needsOtherText || industryOther.trim().length > 0)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const [prefRes, usageRes, onbRes, canvaRes] = await Promise.all([
        fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/usage', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/onboarding', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/canva/status', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (prefRes.ok) {
        const data = await prefRes.json()
        setLanguage(data.language ?? 'zh-TW')
      }
      if (usageRes.ok) {
        setUsage(await usageRes.json())
      }
      if (onbRes.ok) {
        const j = await onbRes.json()
        if (j.data?.optimizationGoal) setAdGoal(j.data.optimizationGoal)
        if (j.data?.industry) setIndustry(j.data.industry)
        if (j.data?.industryOther) setIndustryOther(j.data.industryOther)
        if (j.data?.brandName) setBrandName(j.data.brandName)
        if (j.data?.extraContext) setExtraContext(j.data.extraContext)
      }
      if (canvaRes.ok) {
        const c = await canvaRes.json()
        setCanvaConnected(!!c.connected)
      }
      setLoading(false)
    })
    return unsub
  }, [router])

  async function handleLanguageChange(lang: Language) {
    setLanguage(lang)
    await fetch('/api/user/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang }),
    })
  }

  async function handleGoalSave() {
    if (!goalReady) return
    setGoalSaveState('saving')
    const body: Record<string, unknown> = { optimizationGoal: adGoal, industry }
    if (needsOtherText) body.industryOther = industryOther.trim()
    else body.industryOther = null
    const res = await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setGoalSaveState('ok')
      setTimeout(() => setGoalSaveState('idle'), 2500)
    } else {
      setGoalSaveState('error')
      setTimeout(() => setGoalSaveState('idle'), 3000)
    }
  }

  async function handleBrandSave() {
    setBrandSaveState('saving')
    const res = await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName: brandName.trim() || null,
        extraContext: extraContext.trim() || null,
      }),
    })
    if (res.ok) {
      setBrandSaveState('ok')
      setTimeout(() => setBrandSaveState('idle'), 2500)
    } else {
      setBrandSaveState('error')
      setTimeout(() => setBrandSaveState('idle'), 3000)
    }
  }


  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-400">載入中⋯⋯</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600">← 返回</button>
          <h1 className="text-base font-bold text-gray-900">設定</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-8 py-8 space-y-6">

        {/* Usage & Plan */}
        {usage && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-800">本月用量</h2>
                <p className="text-xs text-gray-400 mt-0.5">每月 1 日重置</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${usage.tier === 'pro' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                {usage.tier === 'pro' ? 'Pro' : 'Free'}
              </span>
            </div>

            <div className="space-y-4">
              {/* Image usage */}
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>圖片生成</span>
                  <span className="font-mono">{usage.imageCount} / {usage.imageLimit} 張</span>
                </div>
                <ProgressBar used={usage.imageCount} limit={usage.imageLimit} />
              </div>

              {/* Video usage */}
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>影片生成</span>
                  {usage.videoSecondsLimit === 0
                    ? <span className="text-gray-400">Free 方案不開放</span>
                    : <span className="font-mono">{usage.videoSeconds} / {usage.videoSecondsLimit} 秒</span>
                  }
                </div>
                {usage.videoSecondsLimit > 0 && (
                  <ProgressBar used={usage.videoSeconds} limit={usage.videoSecondsLimit} />
                )}
              </div>
            </div>

          </div>
        )}

        {/* Language */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">語言 / Language</h2>
          <p className="text-xs text-gray-400 mb-4">影響 AI Sidekick 的回應語言。其他 UI 全面翻譯將於後續版本推出。</p>
          <div className="flex gap-4">
            {([['zh-TW', '繁體中文'], ['en', 'English']] as [Language, string][]).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="language"
                  value={val}
                  checked={language === val}
                  onChange={() => handleLanguageChange(val)}
                  className="cursor-pointer accent-blue-600"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Ad Goal & Industry */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">廣告目標設定</h2>
          <p className="text-xs text-gray-400 mb-5">調整後儀表板的 KPI 排序與 AI Sidekick 建議會同步更新。</p>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">最在乎的廣告目標</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: 'clicks', t: '提升點擊率', d: 'CTR / CPC / 連結點擊' },
                  { v: 'conversion', t: '提升轉換與 ROI', d: 'ROAS / CPA / 轉換數' },
                  { v: 'reach', t: '擴大品牌觸及', d: 'CPM / 觸及 / 曝光' },
                  { v: 'event', t: '活動報名推廣', d: 'CTR / CPL / 頁面瀏覽' },
                ] as const).map(opt => {
                  const active = adGoal === opt.v
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setAdGoal(opt.v)}
                      className={`rounded-xl border p-3 text-left transition ${active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    >
                      <div className={`text-xs font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}>{opt.t}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">{opt.d}</div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">產業類別</label>
              <div className="flex flex-wrap gap-2">
                {([
                  { v: 'ecommerce', t: '電商 / 零售' },
                  { v: 'education', t: '課程 / 教育訓練' },
                  { v: 'event', t: '活動 / 社群組織' },
                  { v: 'personal_brand', t: '個人品牌 / 自媒體' },
                  { v: 'other', t: '其他' },
                ] as const).map(opt => {
                  const active = industry === opt.v
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setIndustry(opt.v)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
                    >
                      {opt.t}
                    </button>
                  )
                })}
              </div>
              {needsOtherText && (
                <input
                  type="text"
                  value={industryOther}
                  onChange={e => setIndustryOther(e.target.value)}
                  placeholder="請輸入你的產業（例：寵物用品、SaaS、醫美…）"
                  className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 text-gray-700"
                  autoFocus
                />
              )}
            </div>
            <button
              onClick={handleGoalSave}
              disabled={goalSaveState === 'saving' || !goalReady}
              className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {goalSaveState === 'saving' ? '儲存中⋯' : goalSaveState === 'ok' ? '已儲存 ✓' : goalSaveState === 'error' ? '儲存失敗' : '儲存'}
            </button>
          </div>
        </div>

        {/* Brand context */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">AI 顧問背景補充</h2>
          <p className="text-xs text-gray-400 mb-5">填寫後，AI Sidekick 會依你的品牌 / 組織給出更精準的廣告建議。留空則沿用上方產業設定。</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">品牌 / 組織名稱</label>
              <input
                type="text"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="例：TM 分會、XX 電商、OO 學院"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">補充說明（選填）</label>
              <input
                type="text"
                value={extraContext}
                onChange={e => setExtraContext(e.target.value)}
                placeholder="例：主要銷售女裝，目標受眾 25-40 歲女性，客單價 $1,500"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700"
              />
            </div>
            <button
              onClick={handleBrandSave}
              disabled={brandSaveState === 'saving'}
              className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {brandSaveState === 'saving' ? '儲存中⋯' : brandSaveState === 'ok' ? '已儲存 ✓' : brandSaveState === 'error' ? '儲存失敗' : '儲存'}
            </button>
          </div>
        </div>


        {/* Canva Integration */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">Canva 整合</h2>
          <p className="text-xs text-gray-400 mb-5">連接 Canva 後，AI Sidekick 可分析你的設計稿並上傳圖片素材。</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${canvaConnected ? 'bg-green-400' : 'bg-gray-300'}`} />
              <span className="text-sm text-gray-700">
                {canvaConnected === null ? '檢查中⋯' : canvaConnected ? '已連接' : '尚未連接'}
              </span>
            </div>
            {!canvaConnected && (
              <button
                onClick={connectCanva}
                disabled={!idToken}
                className="px-4 py-2 bg-[#8B5CF6] text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                連接 Canva
              </button>
            )}
            {canvaConnected && (
              <span className="text-xs text-green-600 font-semibold">✓ 授權有效</span>
            )}
          </div>
          {canvaMsg === 'connected' && (
            <p className="text-xs text-green-600 mt-3">✅ Canva 連接成功！</p>
          )}
          {/* Only surface an error when we're genuinely not connected — a stale
              bad_state replay after a successful connect should not alarm. */}
          {canvaMsg === 'error' && canvaConnected === false && (
            <p className="text-xs text-red-500 mt-3">連接失敗，請稍後再試。</p>
          )}
        </div>

      </div>
    </main>
  )
}
