'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

export type Lang = 'zh-TW' | 'en'

interface LangCtx {
  lang: Lang
  /** 設定語言（即時切換 + 寫 localStorage；不負責寫後端，由 settings 頁 POST 偏好）。 */
  setLang: (l: Lang) => void
  /** 就地雙語：lang==='en' 回英文，否則回中文。 */
  L: (zh: string, en: string) => string
}

const Ctx = createContext<LangCtx>({ lang: 'zh-TW', setLang: () => {}, L: (zh) => zh })

export function useLang() {
  return useContext(Ctx)
}

const LS_KEY = 'cl_dash_lang'

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh-TW')

  // 1) 掛載先讀 localStorage（即時、不閃爍）。
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved === 'en' || saved === 'zh-TW') setLangState(saved)
  }, [])

  // 2) 登入後向後端確認偏好（換裝置時 localStorage 沒值的情況）。
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return
      try {
        const token = await u.getIdToken()
        const res = await fetch('/api/user/preferences', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const d = await res.json()
        if (d.language === 'en' || d.language === 'zh-TW') {
          setLangState(d.language)
          localStorage.setItem(LS_KEY, d.language)
        }
      } catch {
        /* best-effort */
      }
    })
    return () => unsub()
  }, [])

  // Sync <html lang> so the browser localizes native widgets (e.g. the
  // <input type="date"> placeholder 年/月/日 vs mm/dd/yyyy) to the chosen language.
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(LS_KEY, l)
  }, [])

  const L = useCallback((zh: string, en: string) => (lang === 'en' ? en : zh), [lang])

  return <Ctx.Provider value={{ lang, setLang, L }}>{children}</Ctx.Provider>
}
