'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'
import { FbPostsTable } from '@/components/dashboard/FbPostsTable'
import { IgPostsTable } from '@/components/dashboard/IgPostsTable'
import { CombinedPostsTable } from '@/components/dashboard/CombinedPostsTable'

interface PageTokenData {
  pageName: string
  pageId: string
  igUserId: string | null
}

type Tab = 'fb' | 'ig' | 'combined'

export default function DashboardPage() {
  const router = useRouter()
  const [pageData, setPageData] = useState<PageTokenData | null>(null)
  const [fbPosts, setFbPosts] = useState<unknown[]>([])
  const [igPosts, setIgPosts] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('combined')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }

      const tokenSnap = await getDoc(doc(db, 'users', u.uid, 'metaTokens', 'page'))
      if (tokenSnap.exists()) setPageData(tokenSnap.data() as PageTokenData)

      const idToken = await u.getIdToken()
      const headers = { Authorization: `Bearer ${idToken}` }

      const [fbRes, igRes] = await Promise.all([
        fetch('/api/insights/fb', { headers }),
        fetch('/api/insights/ig', { headers }),
      ])

      if (fbRes.ok) { const d = await fbRes.json(); setFbPosts(d.posts ?? []) }
      if (igRes.ok) { const d = await igRes.json(); setIgPosts(d.posts ?? []) }

      setLoading(false)
    })
    return unsub
  }, [router])

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/auth/login')
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">載入中⋯⋯</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">ContentLoop</h1>
            {pageData && <p className="text-xs text-gray-400">{pageData.pageName}</p>}
          </div>
          <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-gray-600">
            登出
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-8 py-6">
        {!pageData ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-4 text-sm text-gray-500">尚未連接 Facebook 粉專</p>
            <button
              onClick={() => router.push('/auth/connect')}
              className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166FE5]"
            >
              連接 Facebook
            </button>
          </div>
        ) : (
          <>
            {/* Filter Bar */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-1 rounded-lg bg-gray-200 p-1">
                <button
                  onClick={() => setActiveTab('combined')}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                    activeTab === 'combined'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  FB + IG
                </button>
                <button
                  onClick={() => setActiveTab('fb')}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                    activeTab === 'fb'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Facebook
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                    {fbPosts.length}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('ig')}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                    activeTab === 'ig'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Instagram
                  <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-xs text-pink-700">
                    {igPosts.length}
                  </span>
                </button>
              </div>
              <p className="text-xs text-gray-400">每日凌晨 3 點自動更新</p>
            </div>

            {/* Content */}
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              {activeTab === 'combined' && (
                <CombinedPostsTable fbPosts={fbPosts as never[]} igPosts={igPosts as never[]} />
              )}
              {activeTab === 'fb' && <FbPostsTable posts={fbPosts as never[]} />}
              {activeTab === 'ig' && <IgPostsTable posts={igPosts as never[]} />}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
