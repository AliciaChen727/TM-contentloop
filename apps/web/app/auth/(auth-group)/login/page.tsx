'use client'

import { signInWithPopup, signOut, linkWithCredential, FacebookAuthProvider, type AuthCredential, type AuthError } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { auth, googleProvider, facebookProvider } from '@/lib/firebase/client'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  // Pre-auth page has no language context; honor the saved UI language preference.
  const [en, setEn] = useState(false)
  useEffect(() => { setEn(localStorage.getItem('cl_dash_lang') === 'en' || localStorage.getItem('cl_lang') === 'en') }, [])
  const L = (zh: string, eng: string) => (en ? eng : zh)

  // In-app browsers (Facebook / IG / LINE / Messenger / Threads / WeChat 等內建
  // webview) 會被 Google 以「Use secure browsers」政策擋下 Google 登入
  // （Error 403: disallowed_useragent）。偵測到就提示使用者改用 Safari/Chrome 開啟。
  const [inAppBrowser, setInAppBrowser] = useState(false)

  // 同一個 email 已存在 Google 帳號時，Firebase 會拒收 Facebook 憑證。要完成連結
  // 得再開一次 Google popup —— 但那必須由使用者親手點擊觸發，直接在 catch 裡開會
  // 被瀏覽器當成非使用者操作擋掉（手機尤其嚴格）。所以先把憑證存起來，改用按鈕。
  const [pendingFbCredential, setPendingFbCredential] = useState<AuthCredential | null>(null)
  useEffect(() => {
    const ua = navigator.userAgent || ''
    const patterns = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|Barcelona|MicroMessenger|Twitter|TikTok|musical_ly|BytedanceWebview/i
    setInAppBrowser(patterns.test(ua))
  }, [])

  async function handlePostLogin(idToken: string) {
    await fetch('/api/auth/accept-invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })

    // All routing decisions go through the server (BFF, Admin SDK) — the client
    // must NOT read Firestore directly (security rules block it → login fails).
    const authRes = await fetch('/api/auth/check-admin-auth', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    const { authorized, hasConnectedMeta } = authRes.ok
      ? await authRes.json()
      : { authorized: false, hasConnectedMeta: false }

    if (authorized) {
      router.push('/dashboard')
    } else if (hasConnectedMeta) {
      // Connected Meta before but no current authorization on any page.
      await signOut(auth)
      setError(L('你沒有取得此粉絲頁的授權，請聯絡管理員取得存取權限。', "You don't have access to this Page. Please contact an admin for access."))
    } else {
      // Brand new user — go connect a page.
      router.push('/auth/connect')
    }
  }

  // popup 被擋 / 被關掉是最常見的失敗，籠統的「登入失敗」看不出該做什麼。
  function describePopupError(err: unknown): string | null {
    const code = (err as AuthError)?.code
    if (code === 'auth/popup-blocked') {
      return L('瀏覽器擋下了登入視窗，請允許彈出視窗後再試一次。', 'Your browser blocked the sign-in window. Please allow pop-ups and try again.')
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return L('登入視窗被關閉了，請再試一次。', 'The sign-in window was closed. Please try again.')
    }
    return null
  }

  async function handleGoogleLogin() {
    try {
      setError('')
      const result = await signInWithPopup(auth, googleProvider)
      const idToken = await result.user.getIdToken()
      await handlePostLogin(idToken)
    } catch (err) {
      console.error('Login failed:', err)
      setError(describePopupError(err) ?? L('登入失敗，請重試。', 'Login failed, please try again.'))
    }
  }

  async function handleFacebookLogin() {
    try {
      setError('')
      setPendingFbCredential(null)
      const result = await signInWithPopup(auth, facebookProvider)
      const idToken = await result.user.getIdToken()
      await handlePostLogin(idToken)
    } catch (err: unknown) {
      const authErr = err as AuthError
      if (authErr?.code === 'auth/account-exists-with-different-credential') {
        // 拿不到憑證時就沒有連結按鈕可按，但訊息一定要出現（以前這條路是靜默失敗的）。
        const fbCredential = FacebookAuthProvider.credentialFromError(authErr)
        setPendingFbCredential(fbCredential)
        setError(
          fbCredential
            ? L('這個 Email 已經用 Google 帳號註冊過。點下方按鈕用 Google 驗證並連結 Facebook，或直接用上方的「使用 Google 帳號登入」。', 'This email is already registered with a Google account. Use the button below to verify with Google and link Facebook, or just use “Sign in with Google” above.')
            : L('這個 Email 已經用 Google 帳號註冊過，請改用上方的「使用 Google 帳號登入」。', 'This email is already registered with a Google account — please use “Sign in with Google” above.')
        )
        return
      }
      console.error('Facebook login failed:', err)
      setError(
        describePopupError(err) ??
          L('Facebook 登入目前暫時無法使用，請改用上方的「使用 Google 帳號登入」。', 'Facebook login is temporarily unavailable — please use “Sign in with Google” above.')
      )
    }
  }

  // 由使用者點擊觸發，popup 才不會被瀏覽器擋。
  async function handleLinkFacebook() {
    if (!pendingFbCredential) return
    try {
      setError('')
      const googleResult = await signInWithPopup(auth, googleProvider)
      try {
        await linkWithCredential(googleResult.user, pendingFbCredential)
      } catch (linkErr: unknown) {
        // 連結只是加分項；失敗也不該擋住已經驗證成功的使用者。
        if ((linkErr as AuthError)?.code !== 'auth/provider-already-linked') {
          console.error('Account linking failed:', linkErr)
        }
      }
      setPendingFbCredential(null)
      const idToken = await googleResult.user.getIdToken()
      await handlePostLogin(idToken)
    } catch (err) {
      console.error('Google sign-in during linking failed:', err)
      setError(
        describePopupError(err) ??
          L('帳號連結失敗，請直接用上方的「使用 Google 帳號登入」。', 'Account linking failed — please use “Sign in with Google” above instead.')
      )
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-gray-50">
      <a
        href="/"
        className="absolute left-5 top-5 flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-800"
      >
        ← {L('返回首頁', 'Back to home')}
      </a>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">ContentLoop</h1>
        <p className="mb-8 text-sm text-gray-500">{L('登入以管理你的內容成效', 'Sign in to manage your content performance')}</p>
        {inAppBrowser && (
          <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">{L('請改用 Safari 或 Chrome 開啟', 'Please open in Safari or Chrome')}</p>
            <p className="mt-1 leading-relaxed">
              {L('偵測到你正從其他 App 的內建瀏覽器開啟，Google 基於安全政策會禁止在這裡登入。請點畫面右上角的「⋯」或分享鍵，選擇「在 Safari 開啟」（或用瀏覽器開啟），再重新登入。',
                 'You are in an app’s built-in browser, where Google blocks sign-in for security. Tap the “⋯” or share button at the top and choose “Open in Safari” (or open in a browser), then sign in again.')}
            </p>
          </div>
        )}
        {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        {pendingFbCredential && (
          <button
            onClick={handleLinkFacebook}
            className="mb-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            {L('用 Google 驗證並連結 Facebook', 'Verify with Google and link Facebook')}
          </button>
        )}
        <button
          onClick={handleGoogleLogin}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {L('使用 Google 帳號登入', 'Sign in with Google')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{L('或', 'or')}</span>
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        </div>

        <button
          onClick={handleFacebookLogin}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <svg className="h-5 w-5" fill="#1877F2" viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          {L('使用 Facebook 帳號登入', 'Sign in with Facebook')}
        </button>

      </div>
    </main>
  )
}
