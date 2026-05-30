'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, getDocs } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'
import { Suspense } from 'react'

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts', // needed to read the Page Stories edge (/{page}/stories)
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'ads_read',
  'business_management',
].join(',')

function ConnectContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)

  const errorType = searchParams.get('error')
  const errorMsg = searchParams.get('msg')
  const [pageLabel, setPageLabel] = useState<string>('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/auth/login')
        return
      }
      // Query existing page tokens to show the correct page name in instructions
      try {
        const tokensSnap = await getDocs(collection(db, 'users', user.uid, 'metaTokens'))
        const names = Array.from(new Set(
          tokensSnap.docs
            .filter(d => d.id !== 'userToken' && d.data().pageName)
            .map(d => d.data().pageName as string)
        ))
        setPageLabel(names.length > 0 ? names.join('、') : '')
      } catch {
        // silently ignore — will show generic fallback
      }
      setChecking(false)
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
        <p className="mb-4 text-sm text-gray-500">
          授權 ContentLoop 讀取你的 FB 粉專與 IG 成效資料。
        </p>

        {errorType === 'denied' && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4">
            <p className="text-xs font-semibold text-red-700">授權被取消，請重新連接。</p>
          </div>
        )}

        {errorType === 'token' && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4">
            <p className="mb-1 text-xs font-semibold text-red-700">連接失敗，請重試。</p>
            {errorMsg && (
              <p className="break-all text-xs text-red-500">{decodeURIComponent(errorMsg)}</p>
            )}
            <p className="mt-2 text-xs text-red-400">提示：請確認在 Facebook 上已被加為此粉絲頁的「管理員（Admin）」角色，且授權時有勾選此粉絲頁。</p>
          </div>
        )}

        <div className="mb-6 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">授權步驟說明</p>

          {/* Step 1 */}
          <div className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">1</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">選擇商家</p>
              <p className="mt-0.5 text-xs text-gray-500">
                只勾選 <strong className="text-gray-700">{pageLabel || '你的品牌/組織'}</strong> 相關商家，其餘商家<span className="text-red-500 font-medium">不需勾選</span>，直接點「下一步」。
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">2</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">選擇粉絲專頁</p>
              <p className="mt-0.5 text-xs text-gray-500">
                只勾選 <strong className="text-gray-700">{pageLabel ? `「${pageLabel}」` : '你的品牌粉絲專頁'}</strong>，其他粉專<span className="text-red-500 font-medium">不需勾選</span>，直接點「下一步」。
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white">!</span>
            <div>
              <p className="text-xs font-semibold text-amber-800">出現其他商家資產、廣告帳戶等畫面？</p>
              <p className="mt-0.5 text-xs text-amber-700"><strong>不需要勾選任何項目</strong>，直接點「下一步」或「完成」即可完成授權。</p>
            </div>
          </div>
        </div>

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

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectContent />
    </Suspense>
  )
}
