'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { Suspense } from 'react'

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content', // needed for reactions/comments/shares on /{page}/posts (Graph #10 without it)
  // pages_manage_posts 已移除（原用於讀 FB Page Stories edge）：它是「發文/管理」等級的
  // 高風險權限卻只拿來讀，且 FB 限動 insights 恆 0、App Review 展示價值低、會拖累整批審查。
  // 日後若確定要 FB 限動且 Meta 開放其數據，再單獨補送。詳見 docs/meta-app-review.md。
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'ads_read',
  'business_management',
  // Phase 5-1 私訊分析（唯讀統計）：讀 IG/FB 對話做「每日則數/發問人數」等統計。
  // 開發模式下 app admin/tester 可直接授權使用，無須等 App Review；日後開放
  // 一般使用者才需單獨送這兩個 messaging 權限審查。詳見 docs/phase-5-messaging-analytics-chatbot.md。
  'instagram_manage_messages',
  'pages_messaging',
  // S4b Agent 自動發布（寫入）：發布貼文到 FB 粉專 / IG。開發模式下 app admin/tester
  // 可直接授權使用；一般使用者需單獨送 App Review（見 docs/meta-app-review.md）。
  'pages_manage_posts',
  'instagram_content_publish',
].join(',')

function ConnectContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)

  const errorType = searchParams.get('error')
  const errorMsg = searchParams.get('msg')
  const [pageLabel, setPageLabel] = useState<string>('')
  // Pre-auth page (no language context); honor the saved UI language preference.
  const [en, setEn] = useState(false)
  useEffect(() => { setEn(localStorage.getItem('cl_dash_lang') === 'en' || localStorage.getItem('cl_lang') === 'en') }, [])
  const L = (zh: string, eng: string) => (en ? eng : zh)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/auth/login')
        return
      }
      // Query existing pages via server (BFF — client never reads Firestore)
      // to show the correct page name in instructions.
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } })
        const pages: { pageName?: string }[] = res.ok ? ((await res.json()).pages ?? []) : []
        const names = Array.from(new Set(
          pages.map(p => p.pageName).filter((n): n is string => !!n)
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
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{L('連接 Facebook', 'Connect Facebook')}</h1>
        <p className="mb-4 text-sm text-gray-500">
          {L('授權 ContentLoop 讀取你的 FB 粉專與 IG 成效資料。', 'Authorize ContentLoop to read your FB Page and IG performance data.')}
        </p>

        {errorType === 'denied' && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4">
            <p className="text-xs font-semibold text-red-700">{L('授權被取消，請重新連接。', 'Authorization was cancelled. Please reconnect.')}</p>
          </div>
        )}

        {errorType === 'token' && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4">
            <p className="mb-1 text-xs font-semibold text-red-700">{L('連接失敗，請重試。', 'Connection failed, please retry.')}</p>
            {errorMsg && (
              <p className="break-all text-xs text-red-500">{decodeURIComponent(errorMsg)}</p>
            )}
            <p className="mt-2 text-xs text-red-400">{L('提示：請確認在 Facebook 上已被加為此粉絲頁的「管理員（Admin）」角色，且授權時有勾選此粉絲頁。', 'Tip: make sure you are an Admin of this Page on Facebook, and that you selected this Page during authorization.')}</p>
          </div>
        )}

        <div className="mb-6 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{L('授權步驟說明', 'Authorization steps')}</p>

          {/* Step 1 */}
          <div className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">1</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">{L('選擇商家', 'Choose a business')}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {L('只勾選 ', 'Select only the business related to ')}<strong className="text-gray-700">{pageLabel || L('你的品牌/組織', 'your brand/organization')}</strong>{L(' 相關商家，其餘商家', '; ')}<span className="text-red-500 font-medium">{L('不需勾選', 'leave the others unchecked')}</span>{L('，直接點「下一步」。', ', then click "Next".')}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">2</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">{L('選擇粉絲專頁', 'Choose a Page')}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {L('只勾選 ', 'Select only ')}<strong className="text-gray-700">{pageLabel ? `「${pageLabel}」` : L('你的品牌粉絲專頁', 'your brand Page')}</strong>{L('，其他粉專', '; ')}<span className="text-red-500 font-medium">{L('不需勾選', 'leave the other Pages unchecked')}</span>{L('，直接點「下一步」。', ', then click "Next".')}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white">!</span>
            <div>
              <p className="text-xs font-semibold text-amber-800">{L('出現其他商家資產、廣告帳戶等畫面？', 'See other business assets, ad accounts, etc.?')}</p>
              <p className="mt-0.5 text-xs text-amber-700"><strong>{L('不需要勾選任何項目', "You don't need to check anything")}</strong>{L('，直接點「下一步」或「完成」即可完成授權。', ' — just click "Next" or "Done" to finish authorization.')}</p>
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
          {L('連接 Facebook 粉絲專頁', 'Connect Facebook Page')}
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
