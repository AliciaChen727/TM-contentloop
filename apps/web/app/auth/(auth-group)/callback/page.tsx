'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

function CallbackHandler() {
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

    let resolved = false
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (resolved) return
      // Firebase auth初始化時可能先fire null，等第一個非null或超時
      if (user === null && !auth.currentUser) {
        // 可能還在初始化，給一次機會等真正的user
        setTimeout(() => {
          if (!resolved) {
            unsub()
            router.replace('/auth/login')
          }
        }, 2000)
        return
      }
      resolved = true
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
          const msg = encodeURIComponent(data.error ?? 'token exchange failed')
          router.replace(`/auth/connect?error=token&msg=${msg}`)
          return
        }

        router.replace('/dashboard')
      } catch (err) {
        console.error('Unexpected error:', err)
        router.replace('/auth/connect?error=token')
      }
    })
  }, [router, searchParams])

  return null
}

export default function CallbackPage() {
  const [en, setEn] = useState(false)
  useEffect(() => { setEn(localStorage.getItem('cl_dash_lang') === 'en' || localStorage.getItem('cl_lang') === 'en') }, [])
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">{en ? 'Connecting to Facebook, please wait…' : '正在連接 Facebook，請稍候⋯⋯'}</p>
      <Suspense>
        <CallbackHandler />
      </Suspense>
    </main>
  )
}
