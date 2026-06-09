'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n/LanguageProvider'

export function ProfileMenu({ userName, role, isOwner, onSignOut }: {
  userName: string
  role: 'admin' | 'viewer'
  isOwner?: boolean
  onSignOut: () => void
}) {
  const { L } = useLang()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const initial = (userName || '?').charAt(0).toUpperCase()

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

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
          border: '1px solid #E5E7EB', width: 200,
        }}>
          {/* User info */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{userName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: role === 'admin' ? '#3B6FD4' : '#9CA3AF', display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: '#6B7280' }}>{role === 'admin' ? 'Admin' : 'Viewer'}</span>
            </div>
          </div>

          {/* Members link (admin only) */}
          {role === 'admin' && (
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #F3F4F6' }}>
              <button
                onClick={() => { setOpen(false); router.push('/dashboard/members') }}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '7px 8px', borderRadius: 6, fontSize: 13, color: '#374151',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span>{L('成員管理', 'Members')}</span>
                <span style={{ color: '#9CA3AF', fontSize: 11 }}>→</span>
              </button>
            </div>
          )}

          {/* Usage report (owner only) */}
          {isOwner && (
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #F3F4F6' }}>
              <button
                onClick={() => { setOpen(false); router.push('/dashboard/admin') }}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '7px 8px', borderRadius: 6, fontSize: 13, color: '#374151',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span>{L('用量成本報表', 'Usage & cost')}</span>
                <span style={{ color: '#9CA3AF', fontSize: 11 }}>→</span>
              </button>
            </div>
          )}

          {/* Settings link (all roles) */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #F3F4F6' }}>
            <button
              onClick={() => { setOpen(false); router.push('/dashboard/settings') }}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                padding: '7px 8px', borderRadius: 6, fontSize: 13, color: '#374151',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span>{L('設定', 'Settings')}</span>
              <span style={{ color: '#9CA3AF', fontSize: 11 }}>→</span>
            </button>
          </div>

          {/* Sign out */}
          <div style={{ padding: '6px 8px' }}>
            <button
              onClick={onSignOut}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                padding: '7px 8px', borderRadius: 6, fontSize: 13, color: '#6B7280',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {L('登出', 'Sign out')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
