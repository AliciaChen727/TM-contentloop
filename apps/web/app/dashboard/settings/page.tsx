'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

type KeyType = 'anthropic' | 'gemini'
type SaveState = 'idle' | 'saving' | 'ok' | 'error'
type Language = 'zh-TW' | 'en'

interface KeyBlock {
  type: KeyType
  label: string
  placeholder: string
  hint: string
  cost: string
  helpUrl: string
  helpLabel: string
}

const KEY_BLOCKS: KeyBlock[] = [
  {
    type: 'anthropic',
    label: 'Claude API Key',
    placeholder: 'sk-ant-api03-...',
    hint: '用於 AI Sidekick 問答功能',
    cost: '參考成本：Claude Sonnet 4.5 約 $3/M input、$15/M output tokens，每次對話約 $0.01–0.03 美元',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'Anthropic Console',
  },
  {
    type: 'gemini',
    label: 'Gemini API Key',
    placeholder: 'AIza...',
    hint: '用於影片生成（Veo）與圖片生成（Imagen）功能',
    cost: '參考成本：Imagen 3 Fast 約 $0.02 美元 / 張、Veo 2 約 $0.50 美元 / 秒（5 秒影片 ≈ $2.50 美元）。',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    helpLabel: 'Google AI Studio',
  },
]

export default function SettingsPage() {
  const router = useRouter()
  const [idToken, setIdToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [language, setLanguage] = useState<Language>('zh-TW')
  const [keySet, setKeySet] = useState<Record<KeyType, boolean>>({ anthropic: false, gemini: false })
  const [inputs, setInputs] = useState<Record<KeyType, string>>({ anthropic: '', gemini: '' })
  const [saveState, setSaveState] = useState<Record<KeyType, SaveState>>({ anthropic: 'idle', gemini: 'idle' })
  const [errors, setErrors] = useState<Record<KeyType, string>>({ anthropic: '', gemini: '' })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)
      const [keysRes, prefRes] = await Promise.all([
        fetch('/api/user/api-keys', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (keysRes.ok) {
        const data = await keysRes.json()
        setKeySet({ anthropic: !!data.anthropic, gemini: !!data.gemini })
      }
      if (prefRes.ok) {
        const data = await prefRes.json()
        setLanguage(data.language ?? 'zh-TW')
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
