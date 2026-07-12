'use client'
// 跨粉專總覽 (Phase 3B Slice 17): side-by-side ad performance, creative trends,
// audience makeup, and organic posts for every page the caller ADMINS.
// Read-only; data comes from /api/pages/compare (server-side admin filter).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { AudienceCompare, type AudienceSeg } from '@/components/compare/AudienceCompare'
import { TrendCompare, type TrendPoint } from '@/components/compare/TrendCompare'
import { PostsCompare, type PagePosts, type RangeKey } from '@/components/compare/PostsCompare'
import { IgFollowersCompare, type IgAudience } from '@/components/compare/IgFollowersCompare'

interface CompareRow extends PagePosts {
  syncedAt: string
  dateRange: { from: string; to: string }
  summary: { spend: number; ctr: number; cpm: number; cpa: number; conversions: number; reach: number; frequency: number }
  rangedSummary: { spend: number; ctr: number; cpm: number; cpa: number; conversions: number; reach: number; frequency: number }
  promotedPostCount: number
  promotedSpend90d: number
  diagnosisCounts: { critical: number; warning: number }
  audience: AudienceSeg[]
  igAudience: IgAudience | null
  trend: TrendPoint[]
}

const fmt = (n: number, d = 0) => n.toLocaleString('zh-TW', { maximumFractionDigits: d })
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const today = () => new Date().toISOString().slice(0, 10)

export default function ComparePage() {
  const { L } = useLang()
  const router = useRouter()
  const [rows, setRows] = useState<CompareRow[] | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<RangeKey>('90d')
  // Page filter: null = all pages selected (default). Always keeps >=1 selected.
  const [selected, setSelected] = useState<string[] | null>(null)
  const [from, setFrom] = useState(daysAgo(90))
  const [to, setTo] = useState(today())
  const tokenRef = useRef('')

  const load = useCallback(async (token: string, f: string, t: string) => {
    try {
      const res = await fetch(`/api/pages/compare?from=${f}&to=${t}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setRows(d.pages ?? [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows([])
    }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push('/'); return }
      tokenRef.current = await u.getIdToken()
      load(tokenRef.current, from, to)
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, load])

  const changeRange = (k: RangeKey) => {
    setRange(k)
    const f = k === '30d' ? daysAgo(30) : k === '90d' ? daysAgo(90) : from
    const t = k === 'custom' ? to : today()
    setFrom(f); setTo(t)
    if (tokenRef.current) load(tokenRef.current, f, t)
  }
  const changeCustom = (f: string, t: string) => {
    setFrom(f); setTo(t)
    if (tokenRef.current && f && t && f <= t) load(tokenRef.current, f, t)
  }

  if (rows === null) return <LoadingScreen />

  const sel = selected ?? rows.map(r => r.pageId)
  const shown = rows.filter(r => sel.includes(r.pageId))
  const togglePage = (pid: string) => {
    const next = sel.includes(pid) ? sel.filter(x => x !== pid) : [...sel, pid]
    if (next.length >= 1) setSelected(next)
  }
  const active = shown.filter(r => r.rangedSummary.spend > 0)
  const maxSpend = Math.max(1, ...shown.map(r => r.rangedSummary.spend))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{L('跨粉專總覽', 'Cross-page Overview')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {L('你管理的所有粉專並列比較（廣告快照每日凌晨 3 點更新）', 'Side-by-side comparison of every page you admin (ad snapshot updates daily at 3am)')}
          </p>
        </div>
        <button onClick={() => router.push('/dashboard')} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          ← {L('回內容儀表板', 'Back to Dashboard')}
        </button>
      </div>

      {/* Global range selector — applies to the table, trend, and posts below.
          (Audience has no per-date data; labeled as last-synced window.) */}
      <div className="mb-4 flex items-center gap-1.5">
        <span className="mr-1 text-xs text-gray-500">{L('區間', 'Range')}</span>
        {(['30d', '90d', 'custom'] as RangeKey[]).map(k => (
          <button key={k} onClick={() => changeRange(k)}
            className={`rounded-lg px-2.5 py-1 text-xs ${range === k ? 'bg-purple-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {k === '30d' ? L('近30日', '30d') : k === '90d' ? L('近90日', '90d') : L('自訂', 'Custom')}
          </button>
        ))}
        {range === 'custom' && (
          <span className="flex items-center gap-1 text-xs">
            <input type="date" value={from} onChange={e => changeCustom(e.target.value, to)} className="rounded border border-gray-200 px-1.5 py-0.5" />
            ~
            <input type="date" value={to} onChange={e => changeCustom(from, e.target.value)} className="rounded border border-gray-200 px-1.5 py-0.5" />
          </span>
        )}
        <span className="ml-2 text-xs text-gray-400">{from} ~ {to}</span>
      </div>

      {/* Page filter — pick which pages to compare (default: all). */}
      {rows.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-gray-500">{L('粉專', 'Pages')}</span>
          {rows.map(r => (
            <button key={r.pageId} onClick={() => togglePage(r.pageId)}
              className={`rounded-lg px-2.5 py-1 text-xs ${sel.includes(r.pageId) ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-400 hover:bg-gray-50'}`}>
              {r.pageName || r.pageId}
            </button>
          ))}
        </div>
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{L('載入失敗：', 'Failed to load: ')}{error}</div>}
      {rows.length === 0 && !error && (
        <div className="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">{L('沒有可比較的粉專', 'No pages to compare')}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">{L('粉專', 'Page')}</th>
              <th className="px-3 py-3 font-medium text-right">{L('花費（區間）', 'Spend (range)')}</th>
              <th className="px-3 py-3 font-medium text-right">CTR</th>
              <th className="px-3 py-3 font-medium text-right">CPM</th>
              <th className="px-3 py-3 font-medium text-right">CPA</th>
              <th className="px-3 py-3 font-medium text-right">{L('轉換', 'Conv.')}</th>
              <th className="px-3 py-3 font-medium text-right">{L('90天投放貼文', 'Promoted (90d)')}</th>
              <th className="px-3 py-3 font-medium text-right">{L('診斷', 'Alerts')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.pageId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{r.pageName || r.pageId}</div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    {r.rangedSummary.spend > 0 ? '' : L('此區間無投放', 'No ads in this range')}
                  </div>
                  <div className="mt-1 h-1 w-32 rounded bg-gray-100">
                    <div className="h-1 rounded bg-indigo-400" style={{ width: `${Math.round(r.rangedSummary.spend / maxSpend * 100)}%` }} />
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">${fmt(r.rangedSummary.spend)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.rangedSummary.ctr ? `${r.rangedSummary.ctr.toFixed(2)}%` : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.rangedSummary.cpm ? `$${fmt(r.rangedSummary.cpm)}` : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.rangedSummary.cpa ? `$${fmt(r.rangedSummary.cpa, 1)}` : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.rangedSummary.conversions ? fmt(r.rangedSummary.conversions) : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {r.promotedPostCount > 0 ? `${r.promotedPostCount} ${L('篇', '')} / $${fmt(r.promotedSpend90d)}` : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.diagnosisCounts.critical > 0 && <span className="mr-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">🚨 {r.diagnosisCounts.critical}</span>}
                  {r.diagnosisCounts.warning > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">⚠️ {r.diagnosisCounts.warning}</span>}
                  {r.diagnosisCounts.critical === 0 && r.diagnosisCounts.warning === 0 && <span className="text-xs text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TrendCompare pages={shown} />
      <AudienceCompare pages={shown} />
      <IgFollowersCompare pages={shown} />
      <PostsCompare pages={shown} from={from} to={to} />

      <p className="mt-4 text-xs text-gray-400">
        {L(
          `顯示 ${shown.length} 個粉專（${active.length} 個近 30 天有投放）。「90天投放貼文」為貼文層跨帳號統計，涵蓋已結束的戰役。想深入分析，到廣告儀表板問 AI Sidekick「比較我的粉專表現」。`,
          `Showing ${shown.length} pages (${active.length} active in last 30d). "Promoted (90d)" is post-level across all ad accounts, including finished campaigns. For deeper analysis, ask AI Sidekick on the ads dashboard to compare your pages.`,
        )}
      </p>
    </div>
  )
}
