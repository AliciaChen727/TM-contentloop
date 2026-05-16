'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

type KeyType = 'anthropic'
type SaveState = 'idle' | 'saving' | 'ok' | 'error'
type Language = 'zh-TW' | 'en'
type Tier = 'free' | 'pro'

interface KeyBlock {
  type: KeyType
  label: string
  placeholder: string
  hint: string
  cost: string
  helpUrl: string
  helpLabel: string
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

const KEY_BLOCKS: KeyBlock[] = [
  {
    type: 'anthropic',
    label: 'Claude API Key',
    placeholder: 'sk-ant-api03-...',
    hint: '用於 AI Sidekick 問答功能',
    cost: '參考成本：Claude Haiku 4.5 約 $0.80/M input、$4/M output tokens，每次對話約 $0.001–0.005 美元',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'Anthropic Console',
  },
]

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
  const [keySet, setKeySet] = useState<Record<KeyType, boolean>>({ anthropic: false })
  const [inputs, setInputs] = useState<Record<KeyType, string>>({ anthropic: '' })
  const [saveState, setSaveState] = useState<Record<KeyType, SaveState>>({ anthropic: 'idle' })
  const [errors, setErrors] = useState<Record<KeyType, string>>({ anthropic: '' })
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const [keysRes, prefRes, usageRes] = await Promise.all([
        fetch('/api/user/api-keys', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/usage', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (keysRes.ok) {
        const data = await keysRes.json()
        setKeySet({ anthropic: !!data.anthropic, gemini: !!data.gemini })
      }
      if (prefRes.ok) {
        const data = await prefRes.json()
        setLanguage(data.language ?? 'zh-TW')
      }
      if (usageRes.ok) {
        setUsage(await usageRes.json())
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

  async function handleSave(type: KeyType) {
    const key = inputs[type].trim()
    if (!key) return
    setSaveState(s => ({ ...s, [type]: 'saving' }))
    setErrors(e => ({ ...e, [type]: '' }))
    const res = await fetch('/api/user/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, key }),
    })
    if (res.ok) {
      setKeySet(k => ({ ...k, [type]: true }))
      setInputs(i => ({ ...i, [type]: '' }))
      setSaveState(s => ({ ...s, [type]: 'ok' }))
      setTimeout(() => setSaveState(s => ({ ...s, [type]: 'idle' })), 2500)
    } else {
      const d = await res.json()
      setErrors(e => ({ ...e, [type]: d.error ?? '儲存失敗' }))
      setSaveState(s => ({ ...s, [type]: 'error' }))
      setTimeout(() => setSaveState(s => ({ ...s, [type]: 'idle' })), 3000)
    }
  }

  async function handleDelete(type: KeyType) {
    const res = await fetch(`/api/user/api-keys?type=${type}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (res.ok) setKeySet(k => ({ ...k, [type]: false }))
  }

  async function handleUpgrade() {
    setCheckoutLoading(true)
    const res = await fetch('/api/lemonsqueezy/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (res.ok) {
      const { url } = await res.json()
      window.location.href = url
    } else {
      setCheckoutLoading(false)
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    const res = await fetch('/api/lemonsqueezy/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (res.ok) {
      const { url } = await res.json()
      window.location.href = url
    } else {
      setPortalLoading(false)
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

            {/* Upgrade / manage — hidden pending business model decision */}
            {false && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              {usage.tier === 'free' ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">升級 Pro 方案</p>
                    <p className="text-xs text-gray-400">圖片 100 張 + 影片 30 秒 / 月　$9.9 美元 / 月</p>
                  </div>
                  <button
                    onClick={handleUpgrade}
                    disabled={checkoutLoading}
                    className="px-4 py-2 bg-[#3B6FD4] text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
                  >
                    {checkoutLoading ? '跳轉中⋯' : '升級 Pro'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">管理訂閱、更改付款方式或取消</p>
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:border-gray-400 disabled:opacity-50 transition-colors shrink-0"
                  >
                    {portalLoading ? '跳轉中⋯' : '管理訂閱'}
                  </button>
                </div>
              )}
            </div>
            )}
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

        {/* API Keys */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-1">API Keys</h2>
          <p className="text-xs text-gray-400 mb-6">Key 加密後儲存，不會以明文存放。每個人使用自己的 Key，不共用 owner 的額度。</p>

          <div className="space-y-8">
            {KEY_BLOCKS.map(block => (
              <div key={block.type}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-gray-700">{block.label}</label>
                  {keySet[block.type] ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      已設定
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">未設定</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-1">
                  {block.hint}　·　取得 Key：
                  <a href={block.helpUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{block.helpLabel}</a>
                </p>
                <p className="text-xs text-gray-400 mb-2">💰 {block.cost}</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={inputs[block.type]}
                    onChange={e => setInputs(i => ({ ...i, [block.type]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleSave(block.type)}
                    placeholder={keySet[block.type] ? '輸入新 Key 以取代現有設定' : block.placeholder}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 font-mono"
                  />
                  <button
                    onClick={() => handleSave(block.type)}
                    disabled={!inputs[block.type].trim() || saveState[block.type] === 'saving'}
                    className="px-4 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {saveState[block.type] === 'saving' ? '儲存中⋯' : saveState[block.type] === 'ok' ? '已儲存 ✓' : '儲存'}
                  </button>
                  {keySet[block.type] && (
                    <button
                      onClick={() => handleDelete(block.type)}
                      className="px-3 py-2 text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-lg hover:border-red-300 transition-colors shrink-0"
                    >
                      清除
                    </button>
                  )}
                </div>
                {errors[block.type] && (
                  <p className="mt-1.5 text-xs text-red-500">{errors[block.type]}</p>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  )
}
