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
  const [alertEnabled, setAlertEnabled] = useState(false)
  const [alertDays, setAlertDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [alertHour, setAlertHour] = useState(9)
  const [alertEmails, setAlertEmails] = useState<string[]>([''])
  const [alertSaveState, setAlertSaveState] = useState<SaveState>('idle')
  const [pages, setPages] = useState<{ pageId: string; pageName: string; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } | null }[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [copyBanner, setCopyBanner] = useState(false)

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

  // Switch account: forget the current Canva token, then re-open OAuth so the
  // user can pick a different account (via "切換帳號" on Canva's consent screen).
  async function switchCanvaAccount() {
    if (!idToken) return
    await fetch('/api/canva/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
    setCanvaConnected(false)
    setCanvaMsg(null)
    connectCanva()
  }

  async function disconnectCanva() {
    if (!idToken) return
    await fetch('/api/canva/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
    setCanvaConnected(false)
    setCanvaMsg(null)
  }

  const needsOtherText = industry === 'other'
  const goalReady = !!adGoal && !!industry && (!needsOtherText || industryOther.trim().length > 0)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const [prefRes, usageRes, canvaRes, pagesRes] = await Promise.all([
        fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/usage', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/canva/status', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (prefRes.ok) {
        const data = await prefRes.json()
        setLanguage(data.language ?? 'zh-TW')
      }
      if (usageRes.ok) setUsage(await usageRes.json())
      if (canvaRes.ok) { const c = await canvaRes.json(); setCanvaConnected(!!c.connected) }

      // Load pages, then load all page-scoped settings for the active page
      if (pagesRes.ok) {
        const d = await pagesRes.json()
        const pageList: { pageId: string; pageName: string }[] = d.pages ?? []
        setPages(pageList)
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : ''
        const activeId = (savedId && pageList.find(p => p.pageId === savedId)) ? savedId : pageList[0]?.pageId ?? ''
        setSelectedPageId(activeId)
        if (activeId) {
          const [onbRes, alertRes] = await Promise.all([
            fetch(`/api/user/onboarding?pageId=${activeId}`, { headers: { Authorization: `Bearer ${token}` } }),
            fetch(`/api/alerts/settings?pageId=${activeId}`, { headers: { Authorization: `Bearer ${token}` } }),
          ])
          if (onbRes.ok) {
            const j = await onbRes.json()
            setAdGoal(j.data?.optimizationGoal ?? '')
            setIndustry(j.data?.industry ?? '')
            setIndustryOther(j.data?.industryOther ?? '')
            setBrandName(j.data?.brandName ?? '')
            setExtraContext(j.data?.extraContext ?? '')
          }
          if (alertRes.ok) { const a = await alertRes.json(); setAlertEnabled(!!a.alertEnabled); setAlertDays(a.alertDays ?? [1,2,3,4,5]); setAlertHour(a.alertHour ?? 9); setAlertEmails(a.alertEmails?.length ? a.alertEmails : ['']) }
        }
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
    if (selectedPageId) body.pageId = selectedPageId
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

  async function handlePageSwitch(pageId: string) {
    setSelectedPageId(pageId)
    localStorage.setItem('selectedPageId', pageId)
    setCopyBanner(false)
    setAlertEnabled(false); setAlertDays([1,2,3,4,5]); setAlertHour(9); setAlertEmails([''])
    setAdGoal(''); setIndustry(''); setIndustryOther(''); setBrandName(''); setExtraContext('')
    if (!pageId || !idToken) return
    const [onbRes, alertRes] = await Promise.all([
      fetch(`/api/user/onboarding?pageId=${pageId}`, { headers: { Authorization: `Bearer ${idToken}` } }),
      fetch(`/api/alerts/settings?pageId=${pageId}`, { headers: { Authorization: `Bearer ${idToken}` } }),
    ])
    if (onbRes.ok) {
      const j = await onbRes.json()
      if (j.data) {
        setAdGoal(j.data.optimizationGoal ?? '')
        setIndustry(j.data.industry ?? '')
        setIndustryOther(j.data.industryOther ?? '')
        setBrandName(j.data.brandName ?? '')
        setExtraContext(j.data.extraContext ?? '')
      } else {
        // New page with no settings — offer to copy from first page
        const firstPage = pages[0]
        if (firstPage && firstPage.pageId !== pageId) setCopyBanner(true)
      }
    }
    if (alertRes.ok) { const a = await alertRes.json(); setAlertEnabled(!!a.alertEnabled); setAlertDays(a.alertDays ?? [1,2,3,4,5]); setAlertHour(a.alertHour ?? 9); setAlertEmails(a.alertEmails?.length ? a.alertEmails : ['']) }
  }

  async function handleCopyFromFirst() {
    const firstPage = pages[0]
    if (!firstPage || !idToken) return
    const res = await fetch(`/api/user/onboarding?pageId=${firstPage.pageId}`, { headers: { Authorization: `Bearer ${idToken}` } })
    if (res.ok) {
      const j = await res.json()
      if (j.data) {
        setAdGoal(j.data.optimizationGoal ?? '')
        setIndustry(j.data.industry ?? '')
        setIndustryOther(j.data.industryOther ?? '')
        setBrandName(j.data.brandName ?? '')
        setExtraContext(j.data.extraContext ?? '')
      }
    }
    setCopyBanner(false)
  }

  async function handleAlertSave() {
    const pageId = selectedPageId
    if (!pageId) { setAlertSaveState('error'); setTimeout(() => setAlertSaveState('idle'), 3000); return }
    setAlertSaveState('saving')
    const res = await fetch('/api/alerts/settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, alertEnabled, alertDays, alertHour, alertEmails: alertEmails.map(e => e.trim()).filter(Boolean) }),
    })
    if (res.ok) { setAlertSaveState('ok'); setTimeout(() => setAlertSaveState('idle'), 2500) }
    else { setAlertSaveState('error'); setTimeout(() => setAlertSaveState('idle'), 3000) }
  }

  async function handleBrandSave() {
    setBrandSaveState('saving')
    const res = await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(selectedPageId ? { pageId: selectedPageId } : {}),
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

        {/* Page selector — only shown when managing multiple pages */}
        {pages.length > 1 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">目前設定粉專</span>
            <select value={selectedPageId} onChange={e => handlePageSwitch(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700 bg-white">
              {pages.map(p => <option key={p.pageId} value={p.pageId}>{p.pageName}</option>)}
            </select>
          </div>
        )}

        {/* Copy-from-first banner */}
        {copyBanner && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-blue-700">這個粉專還沒有設定，要套用「{pages[0]?.pageName}」的設定嗎？</p>
            <div className="flex gap-2 shrink-0">
              <button onClick={handleCopyFromFirst}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">套用</button>
              <button onClick={() => setCopyBanner(false)}
                className="px-3 py-1.5 border border-blue-300 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-100">略過</button>
            </div>
          </div>
        )}

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

        {/* Ad Alert Notifications — admin only */}
        {!!pages.find(p => p.pageId === selectedPageId)?.permissions === false &&
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">成效診斷優化建議通知</h2>
          <p className="text-xs text-gray-400 mb-5">自動診斷廣告與貼文成效（CTR、素材疲勞、貼文互動、最佳貼文加碼等），在你設定的星期與時間以 Email 通知你（台灣時間）。</p>
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2">通知狀態</div>
            <div className="flex gap-2">
              {([[true, '開啟'], [false, '關閉']] as const).map(([v, label]) => (
                <button key={String(v)} onClick={() => setAlertEnabled(v)}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${alertEnabled === v ? 'border-blue-400 bg-blue-50 text-blue-600 font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {alertEnabled && (
            <>
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">通知星期</div>
                <div className="flex gap-2">
                  {['日','一','二','三','四','五','六'].map((label, d) => {
                    const on = alertDays.includes(d)
                    return (
                      <button key={d}
                        onClick={() => setAlertDays(on ? alertDays.filter(x => x !== d) : [...alertDays, d].sort())}
                        className={`w-9 h-9 rounded-full text-sm font-semibold transition-colors ${on ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">通知時間（整點）</div>
                <select value={alertHour} onChange={e => setAlertHour(Number(e.target.value))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700 bg-white">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2">通知 Email（留空則寄到你的登入信箱）</div>
            <div className="space-y-2">
              {alertEmails.map((email, i) => (
                <div key={i} className="flex gap-2">
                  <input type="email" value={email}
                    onChange={e => { const arr = [...alertEmails]; arr[i] = e.target.value; setAlertEmails(arr) }}
                    placeholder={i === 0 ? '選填，自訂收件信箱' : '新增信箱'}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 text-gray-700" />
                  {alertEmails.length > 1 && (
                    <button onClick={() => setAlertEmails(alertEmails.filter((_, j) => j !== i))}
                      className="px-2 text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                  )}
                </div>
              ))}
              <button onClick={() => setAlertEmails([...alertEmails, ''])}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium mt-1">+ 新增收件人</button>
            </div>
          </div>
          <button onClick={handleAlertSave} disabled={alertSaveState === 'saving'}
            className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {alertSaveState === 'saving' ? '儲存中⋯' : alertSaveState === 'ok' ? '已儲存 ✓' : alertSaveState === 'error' ? '儲存失敗，請重試' : '儲存'}
          </button>
        </div>}

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
              <div className="flex items-center gap-3">
                <span className="text-xs text-green-600 font-semibold">✓ 授權有效</span>
                <button
                  onClick={switchCanvaAccount}
                  disabled={!idToken}
                  className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  切換帳號
                </button>
                <button
                  onClick={disconnectCanva}
                  disabled={!idToken}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                >
                  中斷連接
                </button>
              </div>
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
