'use client'

/**
 * 授權後的 onboarding 關卡 — 接在 Meta OAuth callback 之後、進儀表板之前。
 *
 * 為什麼獨立成一頁：原本 onboarding 只在儀表板偶然觸發（進 /dashboard 且該頁
 * optimizationGoal 為空才跳），實測 8 個粉專有 1 個從沒填過。industry /
 * optimizationGoal 是同業 benchmark 與 AI 建議的輸入，缺漏會直接降低那些功能品質。
 *
 * ⚠️ 佇列只在載入時算一次，之後用索引前進：
 *    OnboardingModal 的「略過」只寫 users/{uid}，**不會**在粉專上留下完成標記
 *    （見 api/user/onboarding POST 的 skip 分支）。若每步都重新跟伺服器要待辦清單，
 *    略過的粉專會一直被算進去 → 無限迴圈。
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { OnboardingModal } from '@/components/OnboardingModal'

interface QueueItem { pageId: string; pageName: string }

export default function AuthOnboardingPage() {
  const router = useRouter()
  const { L } = useLang()
  const [idToken, setIdToken] = useState('')
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const started = useRef(false)

  // ⚠️ 不要用「ref 守衛 + cleanup 取消訂閱」的組合：React 18 StrictMode 在開發模式
  //    會 mount → unmount → mount。第一輪設好 ref 並訂閱，卸載時 cleanup 退訂，
  //    第二輪因 ref 已為 true 直接 return → 最後沒有任何監聽器，永遠停在「載入中」。
  //    改成：每次都訂閱，拿到 user 後在 callback 內部一次性退訂；ref 只防重複執行後續工作。
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (started.current) return
      // Firebase 初始化時可能先送一次 null。直接當成未登入會把已登入的人踢回
      // 登入頁（callback/page.tsx 也有同樣的寬限處理）→ 等真正的 user 或逾時。
      if (!user) {
        if (auth.currentUser) return
        setTimeout(() => {
          if (!started.current && !auth.currentUser) {
            started.current = true
            router.replace('/auth/login')
          }
        }, 2000)
        return
      }
      started.current = true
      unsub()
      const token = await user.getIdToken()
      setIdToken(token)
      const headers = { Authorization: `Bearer ${token}` }

      try {
        // tokensOnly：只拿「這個人自己 OAuth 連接的粉專」。不可用完整清單——
        // super-admin 會拿到全站粉專，變成幫別人的粉專填 onboarding。
        const res = await fetch('/api/pages?tokensOnly=true', { headers })
        const pages: QueueItem[] = res.ok ? ((await res.json()).pages ?? []) : []

        const pending: QueueItem[] = []
        for (const p of pages) {
          const r = await fetch(`/api/user/onboarding?pageId=${encodeURIComponent(p.pageId)}`, { headers })
          const j = r.ok ? await r.json() : null
          if (!j?.data?.optimizationGoal) pending.push(p)
        }

        if (pending.length === 0) { router.replace('/dashboard'); return }
        setQueue(pending)
      } catch {
        // onboarding 失敗絕不能把人擋在門外——直接放行進儀表板。
        router.replace('/dashboard')
      }
    })
    return () => unsub()
  }, [router])

  const advance = () => {
    setIndex(i => {
      const next = i + 1
      if (queue && next >= queue.length) router.replace('/dashboard')
      return next
    })
  }

  if (!queue || index >= queue.length) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">{L('載入中⋯⋯', 'Loading…')}</p>
      </main>
    )
  }

  const current = queue[index]

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 pt-8 text-center">
        <p className="text-sm font-semibold text-gray-700">{current.pageName}</p>
        {queue.length > 1 && (
          <p className="mt-1 text-xs text-gray-500">
            {L(`第 ${index + 1} / ${queue.length} 個粉專`, `Page ${index + 1} of ${queue.length}`)}
          </p>
        )}
      </div>
      <OnboardingModal
        key={current.pageId}
        idToken={idToken}
        pageId={current.pageId}
        onDone={advance}
      />
    </main>
  )
}
