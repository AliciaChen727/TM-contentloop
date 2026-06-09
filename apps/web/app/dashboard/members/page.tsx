'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Permissions { ads: boolean; sidekick: boolean; syncAds: boolean }
interface Member {
  uid: string | null
  email: string
  displayName: string | null
  permissions?: Permissions
  role: 'admin' | 'viewer'
  isOwner?: boolean
  status: 'pending' | 'accepted'
  addedAt: string | null
}

const PERM_LABELS: { key: keyof Permissions; label: string; en: string }[] = [
  { key: 'ads', label: '廣告儀表板', en: 'Ad Dashboard' },
  { key: 'sidekick', label: 'AI Sidekick', en: 'AI Sidekick' },
  { key: 'syncAds', label: '同步廣告資料', en: 'Sync ad data' },
]

const DEFAULT_PERMS: Permissions = { ads: false, sidekick: false, syncAds: false }

export default function MembersPage() {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const router = useRouter()
  const [pageId, setPageId] = useState('')
  const [idToken, setIdToken] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [pageName, setPageName] = useState('')
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [newPerms, setNewPerms] = useState<Permissions>({ ...DEFAULT_PERMS })
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  const loadMembers = useCallback(async (token: string, pid: string) => {
    const res = await fetch(`/api/auth/members?pageId=${pid}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const d = await res.json(); setMembers(d.members ?? []); setPageName(d.pageName ?? '') }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)

      // Check if admin via server (BFF — client never reads Firestore).
      const pagesRes = await fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } })
      const adminPages: { pageId: string }[] = pagesRes.ok ? ((await pagesRes.json()).pages ?? []) : []
      if (adminPages.length === 0) { router.replace('/dashboard'); return }

      const pid = localStorage.getItem('selectedPageId') ?? adminPages[0].pageId
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
      const d = await res.json(); setInviteStatus('error'); setInviteError(d.error ?? L('邀請失敗', 'Invite failed'))
    }
  }

  async function handleDelete(member: Member) {
    const params = new URLSearchParams({ pageId })
    if (member.uid) params.set('uid', member.uid)
    else params.set('email', member.email)
    await fetch(`/api/auth/members?${params}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    await loadMembers(idToken, pageId)
  }

  async function handleResend(member: Member) {
    await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: member.email, pageId, permissions: member.permissions }),
    })
  }

  async function handleToggle(member: Member, key: keyof Permissions) {
    if (member.role === 'admin' || !member.permissions) return
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
      <p className="text-sm text-gray-400">{L('載入中⋯⋯', 'Loading…')}</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600">{L('← 返回', '← Back')}</button>
          <div>
            <h1 className="text-base font-bold text-gray-900">{L('成員管理', 'Members')}</h1>
            {pageName && <p className="text-xs text-gray-400 mt-0.5">{pageName}</p>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-8 py-8 space-y-6">

        {/* Invite section */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-4">{L('邀請新成員', 'Invite a member')}</h2>
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
            <label className="block text-xs font-medium text-gray-500 mb-2">{L('開放權限（預設全部關閉）', 'Permissions (all off by default)')}</label>
            <div className="flex gap-4 flex-wrap">
              {PERM_LABELS.map(({ key, label, en: enLabel }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newPerms[key]}
                    onChange={() => setNewPerms(p => ({ ...p, [key]: !p[key] }))}
                    className="cursor-pointer accent-blue-600"
                  />
                  <span className="text-sm text-gray-600">{en ? enLabel : label}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={handleInvite}
            disabled={inviteStatus === 'sending' || !inviteEmail.trim()}
            className="px-5 py-2 bg-[#3B6FD4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {inviteStatus === 'sending' ? L('寄送中⋯⋯', 'Sending…') : L('送出邀請並寄信', 'Send invite & email')}
          </button>
          {inviteStatus === 'ok' && <p className="text-xs text-green-600 mt-2">{L('邀請已送出，通知信已寄出 ✓', 'Invite sent, notification email delivered ✓')}</p>}
          {inviteStatus === 'error' && <p className="text-xs text-red-500 mt-2">{inviteError}</p>}
        </div>

        {/* Member list */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 mb-4">{L('成員列表', 'Member list')}</h2>
          {members.length === 0 ? (
            <p className="text-sm text-gray-400">{L('尚未邀請任何人', 'No one invited yet')}</p>
          ) : (
            <div className="space-y-4">
              {members.map(m => (
                <div key={m.email} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      {m.displayName && (
                        <div className="text-sm font-medium text-gray-800">{m.displayName}</div>
                      )}
                      <div className={`${m.displayName ? 'text-xs text-gray-400' : 'text-sm font-medium text-gray-700'}`}>{m.email}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {m.role === 'admin' ? (
                          <>
                            <span className="text-xs font-semibold text-indigo-600">Admin</span>
                            {m.isOwner && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 font-medium">Owner</span>}
                          </>
                        ) : (
                          m.status === 'accepted' && <span className="text-xs text-gray-400">Viewer</span>
                        )}
                      </div>
                    </div>
                    {m.status === 'accepted' ? (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        {L('已加入', 'Joined')}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-50 text-yellow-700">
                        {L('待接受', 'Pending')}
                      </span>
                    )}
                  </div>
                  {m.role === 'viewer' && (
                    <div className="flex gap-5 flex-wrap mb-3">
                      {PERM_LABELS.map(({ key, label, en: enLabel }) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={m.permissions?.[key] ?? false}
                            onChange={() => handleToggle(m, key)}
                            className="cursor-pointer accent-blue-600"
                          />
                          <span className="text-xs text-gray-500">{en ? enLabel : label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {m.role === 'viewer' && (
                    <div className="flex gap-3">
                      {m.status === 'pending' && (
                        <button
                          onClick={() => handleResend(m)}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          {L('重新寄信', 'Resend email')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(m)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        {L('移除', 'Remove')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
