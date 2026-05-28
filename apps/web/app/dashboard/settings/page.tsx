'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

type SaveState = 'idle' | 'saving' | 'ok' | 'error'
type Language = 'zh-TW' | 'en'
type Tier = 'free' | 'pro'

interface OrgContext {
  name: string
  type: string
  coreKpi: string
  extraContext: string
}

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
  const [orgCtx, setOrgCtx] = useState<OrgContext>({ name: '', type: '', coreKpi: '', extraContext: '' })
  const [orgSaveState, setOrgSaveState] = useState<SaveState>('idle')
  const [adGoal, setAdGoal] = useState<'clicks' | 'conversion' | 'reach' | 'event' | ''>('')
  const [industry, setIndustry] = useState<'ecommerce' | 'education' | 'event' | 'personal_brand' | 'other' | ''>('')
  const [goalSaveState, setGoalSaveState] = useState<SaveState>('idle')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const [prefRes, usageRes, onbRes] = await Promise.all([
        fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/usage', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/onboarding', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (prefRes.ok) {
        const data = await prefRes.json()
        setLanguage(data.language ?? 'zh-TW')
        if (data.organizationContext) setOrgCtx(data.organizationContext)
      }
      if (usageRes.ok) {
        setUsage(await usageRes.json())
      }
      if (onbRes.ok) {
        const j = await onbRes.json()
        if (j.data?.optimizationGoal) setAdGoal(j.data.optimizationGoal)
        if (j.data?.industry) setIndustry(j.data.industry)
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
    if (!adGoal || !industry) return
    setGoalSaveState('saving')
    const res = await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optimizationGoal: adGoal, industry }),
    })
    if (res.ok) {
      setGoalSaveState('ok')
      setTimeout(() => setGoalSaveState('idle'), 2500)
    } else {
      setGoalSaveState('error')
      setTimeout(() => setGoalSaveState('idle'), 3000)
    }
  }

  async function handleOrgSave() {
    setOrgSaveState('saving')
    const payload = orgCtx.name.trim() ? orgCtx : null
    const res = await fetch('/api/user/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationContext: payload }),
    })
    if (res.ok) {
      setOrgSaveState('ok')
      setTimeout(() => setOrgSaveState('idle'), 2500)
    } else {
      setOrgSaveState('error')
      setTimeout(() => setOrgSaveState('idle'), 3000)
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
            </div>
            <button
              onClick={handleGoalSave}
              disabled={goalSaveState === 'saving' || !adGoal || !industry}
              className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {goalSaveState === 'saving' ? '儲存中⋯' : goalSaveState === 'ok' ? '已儲存 ✓' : goalSaveState === 'error' ? '儲存失敗' : '儲存'}
            </button>
          </div>
        </div>

        {/* Organization Context */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">AI 顧問背景設定</h2>
          <p className="text-xs text-gray-400 mb-5">填寫後，AI Sidekick 會依你的品牌/組織給出更精準的廣告建議。留空則沿用系統預設。</p>
          <div className="space-y-4">
            {([
              { field: 'name' as keyof OrgContext, label: '組織 / 品牌名稱', placeholder: '例：台灣某品牌、XX 電商' },
              { field: 'type' as keyof OrgContext, label: '產業 / 類型', placeholder: '例：電商品牌、餐飲業、非營利組織、SaaS 服務' },
              { field: 'coreKpi' as keyof OrgContext, label: '核心 KPI', placeholder: '例：ROAS、CPL、CPC、品牌曝光' },
              { field: 'extraContext' as keyof OrgContext, label: '補充說明（選填）', placeholder: '例：主要銷售女裝，目標受眾 25-40 歲女性，客單價 $1,500' },
            ] as { field: keyof OrgContext; label: string; placeholder: string }[]).map(({ field, label, placeholder }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                <input
                  type="text"
                  value={orgCtx[field]}
                  onChange={e => setOrgCtx(c => ({ ...c, [field]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700"
                />
              </div>
            ))}
            <button
              onClick={handleOrgSave}
              disabled={orgSaveState === 'saving'}
              className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {orgSaveState === 'saving' ? '儲存中⋯' : orgSaveState === 'ok' ? '已儲存 ✓' : orgSaveState === 'error' ? '儲存失敗' : '儲存'}
            </button>
          </div>
        </div>


      </div>
    </main>
  )
}
