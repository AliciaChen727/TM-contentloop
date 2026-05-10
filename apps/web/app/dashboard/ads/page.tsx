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
import type { NavId, Post, AdData } from '@/components/ads/types'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFbPost(p: any, adPostIds: Set<string>): Post {
  return {
    id: p.id,
    date: p.createdTime?.slice(0, 10) ?? '',
    platform: 'FB',
    title: p.message || '（無文字內容）',
    reach: null,
    likes: p.insights?.reactions ?? 0,
    comments: p.insights?.comments ?? 0,
    saves: null,
    shares: p.insights?.shares ?? 0,
    plays: null,
    type: 'post',
    url: p.permalink || '#',
    hasAd: adPostIds.has(p.id),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIgPost(p: any): Post {
  const isVideo = p.mediaType === 'REELS' || p.mediaType === 'VIDEO'
  return {
    id: p.id,
    date: p.timestamp?.slice(0, 10) ?? '',
    platform: 'IG',
    title: p.caption || '（無文字內容）',
    reach: p.insights?.reach ?? 0,
    likes: p.insights?.likes ?? 0,
    comments: p.insights?.comments ?? 0,
    saves: p.insights?.saved ?? 0,
    shares: p.insights?.shares ?? 0,
    plays: isVideo && (p.insights?.views ?? 0) > 0 ? p.insights.views : null,
    type: isVideo ? 'reels' : 'post',
    url: p.permalink || '#',
    hasAd: false,
  }
}

function inferCreativeType(name: string): string {
  if (/reels/i.test(name)) return 'Reels'
  if (/stories|story/i.test(name)) return 'Stories'
  if (/海報/.test(name)) return '海報'
  return '貼文'
}
function inferThumb(type: string): 'reels' | 'post' | 'stories' | 'poster' {
  if (type === 'Reels') return 'reels'
  if (type === 'Stories') return 'stories'
  if (type === '海報') return 'poster'
  return 'post'
}
function inferStatus(roas: number): 'top' | 'good' | 'ok' | 'bad' {
  if (roas >= 4) return 'top'
  if (roas >= 3) return 'good'
  if (roas >= 1.5) return 'ok'
  return 'bad'
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawAdCreative(c: any, idx: number) {
  const spend = parseFloat(c.spend ?? '0')
  const impressions = parseInt(c.impressions ?? '0')
  const ctr = parseFloat(c.ctr ?? '0')
  const actions: { action_type: string; value: string }[] = c.actions ?? []
  const actionValues: { action_type: string; value: string }[] = c.action_values ?? []
  const conversions = parseFloat(actions.find(a => a.action_type === 'purchase')?.value ?? '0')
  const revenue = parseFloat(actionValues.find(a => a.action_type === 'purchase')?.value ?? '0')
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0
  const cpa = conversions > 0 ? spend / conversions : 0
  const type = inferCreativeType(c.ad_name ?? '')
  return {
    id: c.ad_id ?? String(idx),
    name: c.ad_name ?? `廣告 ${idx + 1}`,
    type,
    channel: 'Meta',
    spend,
    impressions,
    ctr,
    roas,
    cpa,
    thumb: inferThumb(type),
    status: inferStatus(roas),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAdData(raw: any): AdData {
  const s = raw.summary
  const from = raw.dateRange?.from ?? ''
  const to = raw.dateRange?.to ?? ''
  const creatives = Array.isArray(raw.adCreatives) && raw.adCreatives.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.adCreatives.map((c: any, i: number) => mapRawAdCreative(c, i))
    : MOCK_DATA.creatives
  return {
    ...MOCK_DATA,
    creatives,
    overview: {
      ...MOCK_DATA.overview,
      dateRange: `${from} ~ ${to}`,
      summary: {
        spend: s.spend,
        budget: MOCK_DATA.overview.summary.budget,
        roas: s.roas,
        roasTarget: MOCK_DATA.overview.summary.roasTarget,
        cpa: s.cpa,
        cpaTarget: MOCK_DATA.overview.summary.cpaTarget,
        ctr: s.ctr,
        cpm: s.cpm,
        reach: s.reach,
        impressions: s.impressions,
        frequency: s.frequency,
        conversions: s.conversions,
        revenue: s.revenue,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dailySpend: raw.daily.map((d: any) => ({
        date: d.date,
        spend: d.spend,
        revenue: d.revenue,
        roas: d.roas,
      })),
    },
  }
}

export default function AdsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  const [skOpen, setSkOpen] = useState(false)
  const [skInitPrompt, setSkInitPrompt] = useState('')
  const [realPosts, setRealPosts] = useState<Post[] | null>(null)
  const [adData, setAdData] = useState<AdData>(MOCK_DATA)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState('')

  async function fetchAdData(idToken: string, pageId?: string): Promise<Set<string>> {
    const pid = pageId ?? selectedPageId
    const qs = pid ? `?pageId=${pid}` : ''
    const res = await fetch(`/api/ads/data${qs}`, { headers: { Authorization: `Bearer ${idToken}` } })
    if (!res.ok) return new Set()
    const json = await res.json()
    if (json.data) {
      setAdData(buildAdData(json.data))
      setLastSync(json.data.syncedAt ?? null)
      return new Set<string>(json.data.adPostIds ?? [])
    }
    return new Set()
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      if (!u) { router.replace('/auth/login'); return }
      setAuthed(true)

      const idToken = await u.getIdToken()
      const headers = { Authorization: `Bearer ${idToken}` }
      const pageId = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : '') ?? ''
      setSelectedPageId(pageId)
      const qs = pageId ? `?pageId=${pageId}` : ''
      const [fbRes, igRes, adRes] = await Promise.all([
        fetch(`/api/insights/fb${qs}`, { headers }),
        fetch(`/api/insights/ig${qs}`, { headers }),
        fetch(`/api/ads/data${qs}`, { headers }),
      ])

      const adJson = adRes.ok ? await adRes.json() : null
      const initialAdPostIds = new Set<string>(adJson?.data?.adPostIds ?? [])
      if (adJson?.data) {
        setAdData(buildAdData(adJson.data))
        setLastSync(adJson.data.syncedAt ?? null)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fbPosts: Post[] = fbRes.ok ? (await fbRes.json()).posts.filter((p: any) => p.message).map((p: any) => mapFbPost(p, initialAdPostIds)) : []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const igPosts: Post[] = igRes.ok ? (await igRes.json()).posts.filter((p: any) => p.caption).map(mapIgPost) : []
      const merged = [...fbPosts, ...igPosts].sort((a, b) => b.date.localeCompare(a.date))
      setRealPosts(merged)
    })
    return unsub
  }, [router])

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const u = auth.currentUser
      if (!u) return
      const idToken = await u.getIdToken()
      const res = await fetch('/api/ads/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: selectedPageId }),
      })
      const json = await res.json()
      if (!res.ok) { setSyncError(json.error ?? '同步失敗'); return }
      const newIds = await fetchAdData(idToken, selectedPageId)
      setRealPosts(prev => prev ? prev.map(p => p.platform === 'FB' ? { ...p, hasAd: newIds.has(p.id) } : p) : prev)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : '同步失敗')
    } finally {
      setSyncing(false)
    }
  }

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
          <div className="brand" style={{ fontSize: 13 }}>Legacy <span>Toastmasters</span></div>
          <div className="sub">廣告儀表板</div>
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
          {[['Meta', '#888'], ['Facebook', '#1877F2'], ['Instagram', '#E1306C']].map(([l, c]) => (
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
          <div style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11 }}>
            {lastSync ? new Date(lastSync).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '— 尚未同步'}
          </div>
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
            <Icon name="calendar" size={12} />{adData.overview.dateRange}
          </div>
          <button className={`ads-sk-toggle-btn ${skOpen ? 'active' : ''}`} onClick={() => setSkOpen(v => !v)}>
            ✨ AI Sidekick
          </button>
          <button className="ads-btn" onClick={handleSync} disabled={syncing} style={{ fontSize: 12.5, padding: '6px 12px', border: '1px solid var(--ad-border)', borderRadius: 8, background: 'var(--ad-surface)', cursor: syncing ? 'wait' : 'pointer', color: syncError ? 'var(--ad-red, #e53e3e)' : 'var(--ad-text2)' }}>
            {syncing ? '同步中⋯' : syncError ? `⚠ ${syncError}` : '↻ 同步廣告資料'}
          </button>
          <button className="ads-btn primary">
            <Icon name="download" size={13} color="white" />匯出報告
          </button>
        </header>

        <main className="ads-content">
          {active === 'overview' && <OverviewSection data={adData} onAskAI={openSidekick} />}
          {active === 'diagnosis' && <DiagnosisSection data={adData} onAskAI={openSidekick} />}
          {active === 'creative' && <CreativeSection data={adData} onAskAI={openSidekick} />}
          {active === 'posts' && <PostsSection onAskAI={openSidekick} posts={realPosts} />}
          {active === 'time' && <BestTimeSection data={adData} />}
          {active === 'budget' && <BudgetSection data={adData} />}
        </main>
      </div>

      {/* FAB */}
      <button className={`ads-sk-fab ${skOpen ? 'hidden' : ''}`} onClick={() => openSidekick()} title="AI Sidekick">✨</button>

      {/* AI Sidekick Drawer */}
      <AiSidekick open={skOpen} onClose={() => setSkOpen(false)} contextPage={active} initialPrompt={skInitPrompt} />
    </div>
  )
}
