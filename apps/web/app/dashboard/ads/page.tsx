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
import type { NavId, Post, AdData, DiagItem } from '@/components/ads/types'

const NAV: { id: NavId; label: string; icon: string; badge?: string }[] = [
  { id: 'overview', label: '總覽', icon: 'chart' },
  { id: 'diagnosis', label: '診斷建議', icon: 'alert' },
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
    hasAd: adPostIds.has(p.id) || (p.insights?.paidReach ?? 0) > 0,
    paidReach: p.insights?.paidReach ?? 0,
    organicReach: p.insights?.organicReach ?? 0,
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
  const purchases = parseFloat(actions.find(a => a.action_type === 'purchase')?.value ?? '0')
  const linkClicks = parseFloat(actions.find(a => a.action_type === 'link_click')?.value ?? '0')
  const revenue = parseFloat(actionValues.find(a => a.action_type === 'purchase')?.value ?? '0')
  const hasPurchase = purchases > 0
  const roas = spend > 0
    ? (hasPurchase && revenue > 0 ? revenue / spend : (linkClicks > 0 ? parseFloat((linkClicks / spend * 100).toFixed(2)) : 0))
    : 0
  const cpa = hasPurchase
    ? (purchases > 0 ? parseFloat((spend / purchases).toFixed(2)) : 0)
    : (linkClicks > 0 ? parseFloat((spend / linkClicks).toFixed(2)) : 0)
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
function buildDiagnosis(s: Record<string, number>, creatives: ReturnType<typeof mapRawAdCreative>[], budget: number): DiagItem[] {
  const roasTarget = MOCK_DATA.overview.summary.roasTarget
  const items: DiagItem[] = []

  if ((s.frequency ?? 0) > 3.5) {
    items.push({ id: 'd1', severity: 'critical', type: 'audience_fatigue', title: '受眾疲乏警告',
      desc: `整體帳戶頻率已達 ${(s.frequency).toFixed(2)}，建議暫停或更換素材。`,
      adset: '整體帳戶', metric: `Frequency ${(s.frequency).toFixed(2)}`, threshold: '> 3.5', action: '更換素材 / 擴大受眾' })
  }

  if ((s.roas ?? 0) < roasTarget && (s.spend ?? 0) > 0) {
    items.push({ id: 'd2', severity: 'critical', type: 'low_roas', title: 'ROAS 低於門檻',
      desc: `整體 ROAS 僅 ${(s.roas).toFixed(2)}x，低於目標 ${roasTarget}x，持續虧損。`,
      adset: '整體帳戶', metric: `ROAS ${(s.roas).toFixed(2)}`, threshold: `< ${roasTarget}`, action: '調低預算 / 檢視受眾重疊' })
  }

  const budgetPct = budget > 0 ? (s.spend / budget) * 100 : 0
  if (budgetPct > 80) {
    items.push({ id: 'd3', severity: budgetPct > 95 ? 'critical' : 'warning', type: 'budget', title: '預算超支風險',
      desc: `目前花費進度 ${budgetPct.toFixed(1)}%，需注意月底前燒速。`,
      adset: '整體帳戶', metric: `已花 $${Math.round(s.spend).toLocaleString('zh-TW')}`,
      threshold: `預算 $${Math.round(budget).toLocaleString('zh-TW')}`, action: budgetPct > 95 ? '立即暫停低效組合' : '維持現況，每日監控' })
  }

  const lowCtr = creatives.find(c => c.ctr > 0 && c.ctr < 1.5 && c.spend > 0)
  if (lowCtr) {
    items.push({ id: 'd4', severity: 'warning', type: 'low_ctr', title: 'CTR 偏低素材',
      desc: `素材「${lowCtr.name.slice(0, 25)}」CTR 僅 ${lowCtr.ctr.toFixed(2)}%，低於建議值 1.5%。`,
      adset: lowCtr.name.slice(0, 30), metric: `CTR ${lowCtr.ctr.toFixed(2)}%`, threshold: '< 1.5%', action: '更換廣告文案或素材' })
  } else if ((s.ctr ?? 0) > 0 && (s.ctr) < 1.5) {
    items.push({ id: 'd4', severity: 'warning', type: 'low_ctr', title: 'CTR 偏低',
      desc: `整體 CTR 僅 ${(s.ctr).toFixed(2)}%，低於建議值 1.5%。`,
      adset: '整體帳戶', metric: `CTR ${(s.ctr).toFixed(2)}%`, threshold: '< 1.5%', action: '更換廣告文案或素材' })
  }

  const top = [...creatives].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas)[0]
  if (top && top.roas >= roasTarget) {
    items.push({ id: 'd5', severity: 'good', type: 'top_performer', title: '最佳表現素材',
      desc: `素材「${top.name.slice(0, 25)}」ROAS 達 ${top.roas.toFixed(1)}x，建議增加預算。`,
      adset: top.name.slice(0, 30), metric: `ROAS ${top.roas.toFixed(1)}`, threshold: `目標 ${roasTarget}`, action: `增加預算 20-30%` })
  }

  if (items.length === 0) {
    items.push({ id: 'd0', severity: 'good', type: 'top_performer', title: '帳戶表現良好',
      desc: `ROAS ${(s.roas ?? 0).toFixed(2)}x，高於目標 ${roasTarget}x，各項指標正常。`,
      adset: '整體帳戶', metric: `ROAS ${(s.roas ?? 0).toFixed(2)}`, threshold: `目標 ${roasTarget}`, action: '持續監控，維持現況' })
  }

  return items
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAdData(raw: any): AdData {
  const s = raw.summary ?? {}
  const from = raw.dateRange?.from ?? ''
  const to = raw.dateRange?.to ?? ''
  const creatives = Array.isArray(raw.adCreatives) && raw.adCreatives.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.adCreatives.map((c: any, i: number) => mapRawAdCreative(c, i))
    : MOCK_DATA.creatives
  const budget = MOCK_DATA.overview.summary.budget
  const realCreatives = creatives !== MOCK_DATA.creatives && creatives.length > 0
  const diagnosis = buildDiagnosis(s as Record<string, number>, realCreatives ? creatives : [], budget)

  // Real adsets from per-creative data
  const realAdsets = realCreatives
    ? creatives.map((c: ReturnType<typeof mapRawAdCreative>) => ({
        name: c.name,
        budget: c.spend > 0 ? Math.round(c.spend / 0.8) : 1000,
        spent: Math.round(c.spend),
        roas: c.roas,
        cpa: Math.round(c.cpa),
      }))
    : MOCK_DATA.budget.adsets

  // Real weekly ROAS from daily data
  const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dayMap: Record<number, { sum: number; count: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (raw.daily ?? []).forEach((d: any) => {
    const dow = new Date(d.date).getDay()
    if (!dayMap[dow]) dayMap[dow] = { sum: 0, count: 0 }
    dayMap[dow].sum += d.roas ?? 0
    dayMap[dow].count++
  })
  const weeklyRoas = [1, 2, 3, 4, 5, 6, 0].map(dow => ({
    day: DAY_NAMES[dow],
    roas: dayMap[dow] ? parseFloat((dayMap[dow].sum / dayMap[dow].count).toFixed(2)) : 0,
    spend: 0,
  }))
  const realWeekly = weeklyRoas.some(w => w.roas > 0) ? weeklyRoas : MOCK_DATA.bestTime.weekly

  // Real hourly ROAS from breakdown data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawHourly: { hour: number; spend: number; roas: number }[] = raw.hourly ?? []
  const realHourly = rawHourly.length > 0
    ? Array.from({ length: 24 }, (_, hour) => {
        const h = rawHourly.find(r => r.hour === hour)
        return { hour, roas: h?.roas ?? 0, spend: h?.spend ?? 0 }
      })
    : MOCK_DATA.bestTime.hourly

  const conversionType: string = s.conversionType ?? raw.conversionType ?? 'purchase'

  return {
    ...MOCK_DATA,
    creatives,
    diagnosis,
    conversionType,
    budget: { ...MOCK_DATA.budget, adsets: realAdsets },
    bestTime: { ...MOCK_DATA.bestTime, weekly: realWeekly, hourly: realHourly },
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
      dailySpend: (raw.daily ?? []).map((d: any) => ({
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
  const [selectedPageName, setSelectedPageName] = useState('')

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

      try {
        const idToken = await u.getIdToken()
        const headers = { Authorization: `Bearer ${idToken}` }
        const pageId = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageId') : '') ?? ''
        const pageName = (typeof window !== 'undefined' ? localStorage.getItem('selectedPageName') : '') ?? ''
        setSelectedPageId(pageId)
        setSelectedPageName(pageName)
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
        const fbJson = fbRes.ok ? await fbRes.json() : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fbPosts: Post[] = (fbJson?.posts ?? []).filter((p: any) => p.message).map((p: any) => mapFbPost(p, initialAdPostIds))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const igJson = igRes.ok ? await igRes.json() : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const igPosts: Post[] = (igJson?.posts ?? []).filter((p: any) => p.caption).map(mapIgPost)
        const merged = [...fbPosts, ...igPosts].sort((a, b) => b.date.localeCompare(a.date))
        setRealPosts(merged)
      } catch (err) {
        console.error('ads page load error', err)
        setRealPosts([])
      }
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
          <div className="brand" style={{ fontSize: 13 }}>{selectedPageName || 'ContentLoop'}</div>
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
          {active === 'overview' && <OverviewSection data={adData} onAskAI={openSidekick} posts={realPosts} />}
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
