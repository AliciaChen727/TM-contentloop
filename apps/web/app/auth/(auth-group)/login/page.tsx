'use client'

import { signInWithPopup } from 'firebase/auth'
import { collection, getDocs } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { auth, googleProvider, db } from '@/lib/firebase/client'

export default function LoginPage() {
  const router = useRouter()

  async function handleGoogleLogin() {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user
      const idToken = await user.getIdToken()

      // Accept any pending invites for this email
      await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })

      // Check if user already has admin pages (Facebook connected)
      const tokensSnap = await getDocs(collection(db, 'users', user.uid, 'metaTokens'))
      const hasAdminPages = tokensSnap.docs.some(d => d.id !== 'userToken')

      if (hasAdminPages) {
        router.push('/dashboard')
      } else {
        // Check if accepted invites gave viewer access
        const pagesRes = await fetch('/api/pages', { headers: { Authorization: `Bearer ${idToken}` } })
        if (pagesRes.ok) {
          const { pages } = await pagesRes.json()
          if (pages.length > 0) { router.push('/dashboard'); return }
        }
        router.push('/auth/connect')
      }
    } catch (err) {
      console.error('Login failed:', err)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">ContentLoop</h1>
        <p className="mb-8 text-sm text-gray-500">登入以管理你的內容成效</p>
        <button
          onClick={handleGoogleLogin}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          使用 Google 帳號登入
        </button>
      </div>
    </main>
  )
}
