'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import type { Role } from '@/lib/auth/roles'

interface Member {
  uid: string | null
  email: string
  displayName: string | null
  role: Role
  source: 'oauth' | 'invite'
  isOwner?: boolean
  status: 'pending' | 'accepted'
  addedAt: string | null
}

// email 可指派的角色（Owner 只能由 OAuth 首連產生，不列入）。
const ASSIGNABLE_ROLES: { value: Role; label: string; en: string; hint: string; enHint: string }[] = [
  { value: 'viewer', label: '檢視者', en: 'Viewer', hint: '唯讀成效', enHint: 'Read-only analytics' },
  { value: 'editor', label: '編輯者', en: 'Editor', hint: '可建草稿 / 同步，不能發布', enHint: 'Draft & sync, no publish' },
  { value: 'admin', label: '管理員', en: 'Admin', hint: '可發布 / 管理成員', enHint: 'Publish & manage members' },
]

const ROLE_BADGE: Record<Role, string> = {
  owner: 'bg-indigo-50 text-indigo-600',
  admin: 'bg-indigo-50 text-indigo-500',
  editor: 'bg-sky-50 text-sky-600',
  viewer: 'bg-gray-100 text-gray-500',
}

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
  const [newRole, setNewRole] = useState<Role>('viewer')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  const roleLabel = useCallback((r: Role) => {
    if (r === 'owner') return 'Owner'
    const found = ASSIGNABLE_ROLES.find(x => x.value === r)
    return found ? (en ? found.en : found.label) : r
  }, [en])

  const loadMembers = useCallback(async (token: string, pid: string) => {
    const res = await fetch(`/api/auth/members?pageId=${pid}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const d = await res.json(); setMembers(d.members ?? []); setPageName(d.pageName ?? '') }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)

      // Check if user can manage members via server (BFF — client never reads Firestore).
      const pagesRes = await fetch('/api/pages?ownOnly=true', { headers: { Authorization: `Bearer ${token}` } })
      const adminPages: { pageId: string; pageName?: string }[] = pagesRes.ok ? ((await pagesRes.json()).pages ?? []) : []
      if (adminPages.length === 0) { router.replace('/dashboard'); return }

      const saved = localStorage.getItem('selectedPageId')
      const active = adminPages.find(p => p.pageId === saved) ?? adminPages[0]
      const pid = active.pageId
      setPageId(pid)
      if (active.pageName) setPageName(active.pageName)
      localStorage.setItem('selectedPageId', pid)
      if (active.pageName) localStorage.setItem('selectedPageName', active.pageName)
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
      body: JSON.stringify({ email: inviteEmail.trim(), pageId, role: newRole }),
    })
    if (res.ok) {
      setInviteStatus('ok'); setInviteEmail(''); setNewRole('viewer')
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
      body: JSON.stringify({ email: member.email, pageId, role: member.role }),
    })
  }

  async function handleChangeRole(member: Member, role: Role) {
    setMembers(prev => prev.map(m => m.email === member.email ? { ...m, role } : m))
    const params = new URLSearchParams({ pageId })
    if (member.uid) params.set('uid', member.uid)
    else params.set('email', member.email)
    const res = await fetch(`/api/auth/members?${params}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) await loadMembers(idToken, pageId) // revert on failure
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <LoadingScreen />
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
            <label className="block text-xs font-medium text-gray-500 mb-2">{L('角色', 'Role')}</label>
            <div className="grid grid-cols-3 gap-2">
              {ASSIGNABLE_ROLES.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setNewRole(r.value)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${newRole === r.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="text-sm font-medium text-gray-800">{en ? r.en : r.label}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{en ? r.enHint : r.hint}</div>
                </button>
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
              {members.map(m => {
                const editable = m.source === 'invite' && m.role !== 'owner'
                return (
                <div key={m.email} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {m.displayName && (
                        <div className="text-sm font-medium text-gray-800 truncate">{m.displayName}</div>
                      )}
                      <div className={`${m.displayName ? 'text-xs text-gray-400' : 'text-sm font-medium text-gray-700'} truncate`}>{m.email}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_BADGE[m.role]}`}>{roleLabel(m.role)}</span>
                        {m.source === 'oauth' && <span className="text-[10px] text-gray-400">{L('已連接', 'Connected')}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
                  </div>

                  {editable && (
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-50">
                      <label className="text-xs text-gray-400">{L('角色', 'Role')}</label>
                      <select
                        value={m.role}
                        onChange={e => handleChangeRole(m, e.target.value as Role)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400 cursor-pointer"
                      >
                        {ASSIGNABLE_ROLES.map(r => (
                          <option key={r.value} value={r.value}>{en ? r.en : r.label}</option>
                        ))}
                      </select>
                      <div className="ml-auto flex gap-3">
                        {m.status === 'pending' && (
                          <button onClick={() => handleResend(m)} className="text-xs text-blue-500 hover:text-blue-700">
                            {L('重新寄信', 'Resend email')}
                          </button>
                        )}
                        <button onClick={() => handleDelete(m)} className="text-xs text-red-400 hover:text-red-600">
                          {L('移除', 'Remove')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
