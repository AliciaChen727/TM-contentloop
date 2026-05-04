'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

export default function CallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error || !code) {
      console.error('OAuth error:', error)
      router.replace('/auth/connect?error=denied')
      return
    }

    // Meta OAuth 是整頁跳轉，Firebase Auth 需要時間重新恢復 session
    // 用 onAuthStateChanged 等待，而非直接讀 auth.currentUser（跳轉後會是 null）
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub()

      if (!user) {
        router.replace('/auth/login')
        return
      }

      try {
        const idToken = await user.getIdToken()

        const res = await fetch('/api/auth/meta', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ code }),
        })

        if (!res.ok) {
          const data = await res.json()
          console.error('Token exchange failed:', data.error)
          router.replace('/auth/connect?error=token')
          return
        }

        router.replace('/dashboard')
      } catch (err) {
        console.error('Unexpected error:', err)
        router.replace('/auth/connect?error=token')
      }
    })
  }, [router, searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">正在連接 Facebook，請稍候⋯⋯</p>
    </main>
  )
}
