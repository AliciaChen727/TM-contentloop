'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { getDocs, collection } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'

interface Permissions { ads: boolean; sidekick: boolean; syncAds: boolean }
interface Member {
  uid: string | null
  email: string
  displayName: string | null
  permissions: Permissions
  status: 'pending' | 'accepted'
  addedAt: string | null
}

const PERM_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'ads', label: '廣告儀表板' },
  { key: 'sidekick', label: 'AI Sidekick' },
  { key: 'syncAds', label: '同步廣告資料' },
]

const DEFAULT_PERMS: Permissions = { ads: false, sidekick: false, syncAds: false }

export default function MembersPage() {
  const router = useRouter()
  const [pageId, setPageId] = useState('')
  const [idToken, setIdToken] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [newPerms, setNewPerms] = useState<Permissions>({ ...DEFAULT_PERMS })
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  const loadMembers = useCallback(async (token: string, pid: string) => {
    const res = await fetch(`/api/auth/members?pageId=${pid}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const d = await res.json(); setMembers(d.members ?? []) }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)

      // Check if admin
      const tokensSnap = await getDocs(collection(db, 'users', u.uid, 'metaTokens'))
      const adminDocs = tokensSnap.docs.filter(d => d.id !== 'userToken')
      if (adminDocs.length === 0) { router.replace('/dashboard'); return }

      const pid = localStorage.getItem('selectedPageId') ?? adminDocs[0].id
      setPageId(pid)
      await loadMembers(token, pid)
      setLoading(false)
    })
    return unsub
  }, [router, loadMembers])

  async function handleInvite() {
    if (!inviteEmail.trim() || !pageId) return
    setInviteStatus('sending'); setInviteError('')
    const res = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), pageId, permissions: newPerms }),
    })
    if (res.ok) {
      setInviteStatus('ok'); setInviteEmail(''); setNewPerms({ ...DEFAULT_PERMS })
      await loadMembers(idToken, pageId)
      setTimeout(() => setInviteStatus('idle'), 3000)
    } else {
      const d = await res.json(); setInviteStatus('error'); setInviteError(d.error ?? '邀請失敗')
    }
  }

  async function handleToggle(member: Member, key: keyof Permissions) {
    const updated = { ...member.permissions, [key]: !member.permissions[key] }
    setMembers(prev => prev.map(m => m.email === member.email ? { ...m, permissions: updated } : m))
    const params = new URLSearchParams({ pageId })
    if (member.uid) params.set('uid', member.uid)
    else params.set('email', member.email)
    await fetch(`/api/auth/members?${params}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: updated }),
    })
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-400">載入中⋯⋯</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600">← 返回</button>
          <h1 className="text-base font-bold text-gray-900">成員管理</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-8 py-8 space-y-6">

        {/* Invite section */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-4">邀請新成員</h2>
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Gmail</label>
            <input
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              placeholder="example@gmail.com"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-500 mb-2">開放權限（預設全部關閉）</label>
            <div className="flex gap-4 flex-wrap">
              {PERM_LABELS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newPerms[key]}
                    onChange={() => setNewPerms(p => ({ ...p, [key]: !p[key] }))}
                    className="cursor-pointer accent-blue-600"
                  />
                  <span className="text-sm text-gray-600">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={handleInvite}
            disabled={inviteStatus === 'sending' || !inviteEmail.trim()}
            className="px-5 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {inviteStatus === 'sending' ? '寄送中⋯⋯' : '送出邀請並寄信'}
          </button>
          {inviteStatus === 'ok' && <p className="text-xs text-green-600 mt-2">邀請已送出，通知信已寄出 ✓</p>}
          {inviteStatus === 'error' && <p className="text-xs text-red-500 mt-2">{inviteError}</p>}
        </div>

        {/* Member list */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-4">成員列表</h2>
          {members.length === 0 ? (
            <p className="text-sm text-gray-400">尚未邀請任何人</p>
          ) : (
            <div className="space-y-4">
              {members.map(m => (
                <div key={m.email} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      {m.displayName && (
                        <div className="text-sm font-medium text-gray-800">{m.displayName}</div>
                      )}
                      <div className={`text-xs ${m.displayName ? 'text-gray-400' : 'text-sm font-medium text-gray-700'}`}>{m.email}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.status === 'accepted'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-yellow-50 text-yellow-700'
                    }`}>
                      {m.status === 'accepted' ? '✓ 已回應（已登入）' : '已送出邀請'}
                    </span>
                  </div>
                  <div className="flex gap-5 flex-wrap">
                    {PERM_LABELS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={m.permissions?.[key] ?? false}
                          onChange={() => handleToggle(m, key)}
                          className="cursor-pointer accent-blue-600"
                        />
                        <span className="text-xs text-gray-500">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
