'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
].join(',')

export default function ConnectPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) router.replace('/auth/login')
      else setChecking(false)
    })
    return unsub
  }, [router])

  function handleConnect() {
    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_META_APP_ID!,
      redirect_uri: process.env.NEXT_PUBLIC_META_REDIRECT_URI!,
      scope: SCOPES,
      response_type: 'code',
      auth_type: 'rerequest',
    })
    window.location.href = `https://www.facebook.com/v19.0/dialog/oauth?${params}`
  }

  if (checking) return null

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">連接 Facebook</h1>
        <p className="mb-2 text-sm text-gray-500">
          授權 ContentLoop 讀取你的 FB 粉專與 IG 成效資料。
        </p>
        <p className="mb-8 text-xs text-gray-400">
          所需權限：pages_show_list、read_insights、instagram_manage_insights
        </p>
        <button
          onClick={handleConnect}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#166FE5]"
        >
          <svg className="h-5 w-5 fill-white" viewBox="0 0 24 24">
            <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
          </svg>
          連接 Facebook 粉絲專頁
        </button>
      </div>
    </main>
  )
}
