'use client'
// Super-admin standalone page: AI bug reports (Slice 18/19 pipeline).
// Entry: ProfileMenu → AI Bug 回報 (below 用量報表). Non-super-admins are
// redirected — the underlying /api/admin/bugs returns 403 for them anyway.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { BugReportsCard } from '@/components/admin/BugReportsCard'

export default function AdminBugsPage() {
  const { L } = useLang()
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      const res = await fetch('/api/admin/bugs', { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 403) { router.replace('/dashboard'); return }
      setReady(true)
    })
    return () => unsub()
  }, [router])

  if (!ready) return <LoadingScreen />

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{L('AI Bug 回報', 'AI Bug Reports')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {L('Agent 自動偵測的系統問題。修復流程：點 Issue → GitHub Actions → AI Bug Fix Agent → review PR 後 merge。',
              'Auto-detected system issues. Fix flow: open the Issue → GitHub Actions → AI Bug Fix Agent → review & merge the PR.')}
          </p>
        </div>
        <button onClick={() => router.push('/dashboard')} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          ← {L('回內容儀表板', 'Back to Dashboard')}
        </button>
      </div>
      <BugReportsCard />
    </main>
  )
}
