'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { MOCK_DATA } from '@/components/ads/mockData'
import { Icon } from '@/components/ads/Icon'
import { AiSidekick } from '@/components/ads/AiSidekick'
import { OverviewSection } from '@/components/ads/sections/OverviewSection'
import { DiagnosisSection } from '@/components/ads/sections/DiagnosisSection'
import { CreativeSection } from '@/components/ads/sections/CreativeSection'
import { PostsSection } from '@/components/ads/sections/PostsSection'
import { BestTimeSection } from '@/components/ads/sections/BestTimeSection'
import { BudgetSection } from '@/components/ads/sections/BudgetSection'
import type { NavId } from '@/components/ads/types'

const NAV: { id: NavId; label: string; icon: string; badge?: string }[] = [
  { id: 'overview', label: '總覽', icon: 'chart' },
  { id: 'diagnosis', label: '診斷建議', icon: 'alert', badge: '2' },
  { id: 'creative', label: '素材庫', icon: 'creative' },
  { id: 'posts', label: '內容表現', icon: 'calendar' },
  { id: 'time', label: '最佳時段', icon: 'clock' },
  { id: 'budget', label: '預算模擬', icon: 'budget' },
]

const NAV_LABELS: Record<NavId, string> = {
  overview: '總覽', diagnosis: '診斷建議', creative: '素材庫',
  posts: '內容表現', time: '最佳時段', budget: '預算模擬',
}

export default function AdsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (!u) router.replace('/auth/login')
      else setAuthed(true)
    })
    return unsub
  }, [router])

  const openSidekick = useCallback((prompt = '') => {
    setSkInitPrompt(prompt)
    setSkOpen(true)
  }, [])

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">載入中⋯⋯</p>
      </main>
    )
  }

  return (
    <div className="ads-root" style={{ display: 'flex', minHeight: '100vh', background: 'var(--ad-bg)', fontFamily: 'var(--font-dm-sans)', color: 'var(--ad-text)', fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: 'antialiased' }}>

      {/* Left Nav */}
      <nav className="ads-nav">
        <div className="ads-nav-logo">
          <div className="brand">Content<span>Loop</span></div>
          <div className="sub">廣告投手儀表板</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
          <div className="ads-nav-section">主要功能</div>
          {NAV.map(item => (
            <div key={item.id} className={`ads-nav-item ${active === item.id ? 'active' : ''}`} onClick={() => setActive(item.id)}>
              <Icon name={item.icon} size={15} color={active === item.id ? 'var(--ad-blue)' : 'var(--ad-text3)'} />
              {item.label}
              {item.badge && <span className="ads-nav-badge">{item.badge}</span>}
            </div>
          ))}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>頻道</div>
          {[['Meta', '#888'], ['Facebook', '#1877F2'], ['Instagram', '#E1306C']] .map(([l, c]) => (
            <div key={l} className="ads-nav-item" style={{ paddingLeft: 14, cursor: 'default' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c, width: 16, display: 'inline-block' }}>{l[0]}</span>
              {l}
            </div>
          ))}
          <div className="ads-nav-section" style={{ marginTop: 8 }}>AI 助手</div>
          <div className="ads-nav-sk-btn" onClick={() => openSidekick()}>
            <span style={{ fontSize: 18 }}>✨</span>
            <div>
              <div className="sk-label">AI Sidekick</div>
              <div className="sk-sub">問我任何廣告問題</div>
            </div>
          </div>
          <div className="ads-nav-section" style={{ marginTop: 8 }}>導覽</div>
          <div className="ads-nav-item" onClick={() => router.push('/dashboard')}>
            <Icon name="ads" size={15} color="var(--ad-text3)" />
            ← 回內容儀表板
          </div>
        </div>
        <div className="ads-nav-footer">
          <div>最後更新</div>
          <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11 }}>2026-05-05 09:32</div>
        </div>
      </nav>

      {/* Main area */}
      <div className={`ads-main ${skOpen ? 'sk-open' : ''}`}>
        <header className="ads-topbar">
          <span className="ads-topbar-title">{NAV_LABELS[active]}</span>
          <div className="ads-channel-badge">
            <Icon name="meta" size={13} color="var(--ad-blue)" />Meta Ads
          </div>
          <div className="ads-date-pill">
            <Icon name="calendar" size={12} />2026-04-05 ~ 05-05
          </div>
          <button className={`ads-sk-toggle-btn ${skOpen ? 'active' : ''}`} onClick={() => setSkOpen(v => !v)}>
            ✨ AI Sidekick
          </button>
          <button className="ads-btn primary">
            <Icon name="download" size={13} color="white" />匯出報告
          </button>
        </header>

        <main className="ads-content">
          {active === 'overview' && <OverviewSection data={MOCK_DATA} onAskAI={openSidekick} />}
          {active === 'diagnosis' && <DiagnosisSection data={MOCK_DATA} onAskAI={openSidekick} />}
          {active === 'creative' && <CreativeSection data={MOCK_DATA} onAskAI={openSidekick} />}
          {active === 'posts' && <PostsSection onAskAI={openSidekick} />}
          {active === 'time' && <BestTimeSection data={MOCK_DATA} />}
          {active === 'budget' && <BudgetSection data={MOCK_DATA} />}
        </main>
      </div>

      {/* FAB */}
      <button className={`ads-sk-fab ${skOpen ? 'hidden' : ''}`} onClick={() => openSidekick()} title="AI Sidekick">✨</button>

      {/* AI Sidekick Drawer */}
      <AiSidekick open={skOpen} onClose={() => setSkOpen(false)} contextPage={active} initialPrompt={skInitPrompt} />
    </div>
  )
}
