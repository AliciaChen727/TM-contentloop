'use client'
import { useState, useRef, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'

interface Permissions { home: boolean; ads: boolean; sidekick: boolean; syncAds: boolean }
interface Member { uid: string; email: string; permissions: Permissions; addedAt: string | null }

const PERM_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'home', label: '首頁' },
  { key: 'ads', label: '廣告' },
  { key: 'sidekick', label: 'AI' },
  { key: 'syncAds', label: '同步' },
]

export function ProfileMenu({ userName, role, pageId, onSignOut }: {
  userName: string
  role: 'admin' | 'viewer'
  pageId: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoaded, setMembersLoaded] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const initial = (userName || '?').charAt(0).toUpperCase()

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => {
    if (!open || role !== 'admin' || membersLoaded || !pageId) return
    async function load() {
      const u = auth.currentUser
      if (!u) return
      const idToken = await u.getIdToken()
      const res = await fetch(`/api/auth/members?pageId=${pageId}`, { headers: { Authorization: `Bearer ${idToken}` } })
      if (res.ok) { const d = await res.json(); setMembers(d.members ?? []); setMembersLoaded(true) }
    }
    load()
  }, [open, role, pageId, membersLoaded])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviteStatus('idle'); setInviteError('')
    const u = auth.currentUser
    if (!u) return
    const idToken = await u.getIdToken()
    const res = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), pageId }),
    })
    if (res.ok) {
      setInviteStatus('ok'); setInviteEmail(''); setMembersLoaded(false)
      setTimeout(() => setInviteStatus('idle'), 2500)
    } else {
      const d = await res.json(); setInviteStatus('error'); setInviteError(d.error ?? '邀請失敗')
    }
  }

  async function handleToggle(uid: string, key: keyof Permissions, current: boolean) {
    const member = members.find(m => m.uid === uid)
    if (!member) return
    const newPerms = { ...member.permissions, [key]: !current }
    setMembers(prev => prev.map(m => m.uid === uid ? { ...m, permissions: newPerms } : m))
    const u = auth.currentUser
    if (!u) return
    const idToken = await u.getIdToken()
    await fetch(`/api/auth/members?pageId=${pageId}&uid=${uid}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: newPerms }),
    })
  }

  return (
    <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: '#374151',
          color: 'white', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {initial}
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 40, left: 0, zIndex: 100,
          background: 'white', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          border: '1px solid #E5E7EB', width: 272,
        }}>
          {/* Role info */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{userName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: role === 'admin' ? '#3B6FD4' : '#9CA3AF', display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: '#6B7280' }}>{role === 'admin' ? 'Admin' : 'Viewer'}</span>
            </div>
          </div>

          {/* Invite */}
          {role === 'admin' && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8 }}>邀請成員</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                  placeholder="輸入 Gmail"
                  style={{ flex: 1, fontSize: 12, padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: 6, outline: 'none', minWidth: 0 }}
                />
                <button
                  onClick={handleInvite}
                  style={{ fontSize: 12, padding: '5px 12px', background: '#3B6FD4', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  送出
                </button>
              </div>
              {inviteStatus === 'ok' && <div style={{ fontSize: 11, color: '#10B981', marginTop: 5 }}>已送出邀請 ✓</div>}
              {inviteStatus === 'error' && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 5 }}>{inviteError}</div>}
            </div>
          )}

          {/* Member list */}
          {role === 'admin' && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', maxHeight: 220, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8 }}>成員列表</div>
              {members.length === 0 ? (
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>尚未邀請任何人</div>
              ) : members.map(m => (
                <div key={m.uid} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #F9FAFB' }}>
                  <div style={{ fontSize: 11, color: '#374151', marginBottom: 5, wordBreak: 'break-all' }}>{m.email}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {PERM_LABELS.map(({ key, label }) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11, color: '#6B7280', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={m.permissions?.[key] ?? false}
                          onChange={() => handleToggle(m.uid, key, m.permissions?.[key] ?? false)}
                          style={{ cursor: 'pointer', accentColor: '#3B6FD4' }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sign out */}
          <div style={{ padding: '10px 16px' }}>
            <button onClick={onSignOut} style={{ fontSize: 13, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              登出
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
