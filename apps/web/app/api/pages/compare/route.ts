// Cross-page comparison (Phase 3B Slice 17). BFF: only pages where the CALLER
// is an admin (resolveAllowedPages access==='admin'). Read-only; never writes
// back to any page snapshot. ?from=YYYY-MM-DD&to=YYYY-MM-DD scopes the ORGANIC
// posts section; ad summary stays the canonical last-30d snapshot and audience
// reflects the last synced ad window (both labeled as such in the UI).
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { resolveAllowedPages } from '@/lib/ai/tools/resolveAllowedPages'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDateStr(v: any): string {
  if (!v) return ''
  if (typeof v === 'string') return v.slice(0, 10)
  if (typeof v?.toDate === 'function') return v.toDate().toISOString().slice(0, 10)
  return ''
}

interface PostStat { count: number; reach: number; engagement: number }
interface TopPost { text: string; url: string; reach: number; engagement: number; platform: 'FB' | 'IG' }

async function loadPostStats(pageId: string, from: string, to: string): Promise<{ fb: PostStat; ig: PostStat; topPost: TopPost | null }> {
  const zero = (): PostStat => ({ count: 0, reach: 0, engagement: 0 })
  const out = { fb: zero(), ig: zero(), topPost: null as TopPost | null }
  const ownerUid = await resolvePageOwnerUid(pageId).catch(() => null)
  if (!ownerUid) return out
  const pageRef = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)
  // ISOLATION: page-scoped collections only (CLAUDE.md; no legacy fallback here).
  const [fbSnap, igSnap] = await Promise.all([
    pageRef.collection('fbPosts').get().catch(() => null),
    pageRef.collection('igPosts').get().catch(() => null),
  ])
  let best: TopPost | null = null
  const consider = (p: TopPost) => { if (!best || p.engagement > best.engagement) best = p }
  for (const doc of fbSnap?.docs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = doc.data() as any
    const date = toDateStr(d.createdTime)
    if (!date || date < from || date > to) continue
    const ins = d.insights ?? {}
    const eng = (ins.reactions ?? 0) + (ins.comments ?? 0) + (ins.shares ?? 0)
    out.fb.count++; out.fb.reach += ins.reach ?? 0; out.fb.engagement += eng
    consider({ text: String(d.message ?? '').slice(0, 60), url: String(d.permalink ?? ''), reach: ins.reach ?? 0, engagement: eng, platform: 'FB' })
  }
  for (const doc of igSnap?.docs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = doc.data() as any
    const date = toDateStr(d.timestamp)
    if (!date || date < from || date > to) continue
    const ins = d.insights ?? {}
    const eng = (ins.likes ?? 0) + (ins.comments ?? 0) + (ins.saved ?? 0) + (ins.shares ?? 0)
    out.ig.count++; out.ig.reach += ins.reach ?? 0; out.ig.engagement += eng
    consider({ text: String(d.caption ?? '').slice(0, 60), url: String(d.permalink ?? ''), reach: ins.reach ?? 0, engagement: eng, platform: 'IG' })
  }
  out.topPost = best
  return out
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Date range for the ORGANIC posts section (default: last 30 days).
  const q = req.nextUrl.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') ?? '') ? q.get('from')! : d30
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') ?? '') ? q.get('to')! : today

  // Admin-only surface: invited viewers must not see other pages here.
  const allowed = (await resolveAllowedPages(uid)).filter(p => p.access === 'admin')
  const rows = await Promise.all(allowed.map(async ({ pageId, pageName }) => {
    const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data() ?? {}
    const summary = (snap.summary ?? {}) as Record<string, number>
    const apm = (snap.adPostMetrics ?? {}) as Record<string, { spend?: number }>
    const igm = (snap.igPostMetrics ?? {}) as Record<string, { spend?: number }>
    const promoted = [...Object.values(apm), ...Object.values(igm)].filter(p => (p.spend ?? 0) > 0)
    // Audience: top ad segments from the last synced window (spend-weighted).
    const demographics = (Array.isArray(snap.demographics) ? snap.demographics : []) as { age: string; gender: string; spend: number; clicks: number; impressions: number }[]
    const audience = demographics
      .filter(d => d.age !== 'unknown' && (d.spend > 0 || d.impressions > 0))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)
      .map(d => ({ age: d.age, gender: d.gender, spend: Math.round(d.spend), impressions: d.impressions, ctr: d.impressions > 0 ? +(d.clicks / d.impressions * 100).toFixed(2) : 0 }))
    // 素材成效趨勢: aggregate per-creative daily series (creativeTrends, from the
    // last synced ad window) into one page-level daily spend/CTR trend.
    const trends = (Array.isArray(snap.creativeTrends) ? snap.creativeTrends : []) as { daily?: { date: string; spend?: number; clicks?: number; impressions?: number; reach?: number; conversions?: number }[] }[]
    const byDate = new Map<string, { spend: number; clicks: number; impressions: number; reach: number; conversions: number }>()
    for (const t of trends) {
      for (const d of t.daily ?? []) {
        if (!d.date || d.date < from || d.date > to) continue // 套用所選區間
        const e = byDate.get(d.date) ?? { spend: 0, clicks: 0, impressions: 0, reach: 0, conversions: 0 }
        e.spend += d.spend ?? 0; e.clicks += d.clicks ?? 0; e.impressions += d.impressions ?? 0
        e.reach += d.reach ?? 0; e.conversions += d.conversions ?? 0
        byDate.set(d.date, e)
      }
    }
    const trend = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-92)
      .map(([date, e]) => ({ date, spend: Math.round(e.spend), ctr: e.impressions > 0 ? +(e.clicks / e.impressions * 100).toFixed(2) : 0 }))
    // Range-scoped ad summary derived from the same daily rows (table columns).
    const agg = Array.from(byDate.values()).reduce((s, e) => ({
      spend: s.spend + e.spend, clicks: s.clicks + e.clicks, impressions: s.impressions + e.impressions,
      reach: s.reach + e.reach, conversions: s.conversions + e.conversions,
    }), { spend: 0, clicks: 0, impressions: 0, reach: 0, conversions: 0 })
    const rangedSummary = {
      spend: Math.round(agg.spend),
      ctr: agg.impressions > 0 ? +(agg.clicks / agg.impressions * 100).toFixed(2) : 0,
      cpm: agg.impressions > 0 ? +(agg.spend / agg.impressions * 1000).toFixed(1) : 0,
      cpa: agg.conversions > 0 ? +(agg.spend / agg.conversions).toFixed(1) : 0,
      conversions: agg.conversions,
      reach: agg.reach,
      frequency: agg.reach > 0 ? +(agg.impressions / agg.reach).toFixed(2) : 0,
    }

    const posts = await loadPostStats(pageId, from, to)
    return {
      pageId,
      pageName,
      syncedAt: toDateStr(snap.syncedAt),
      dateRange: snap.dateRange ?? { from: '', to: '' },
      summary: {
        spend: summary.spend ?? 0, ctr: summary.ctr ?? 0, cpm: summary.cpm ?? 0,
        cpa: summary.cpa ?? 0, conversions: summary.conversions ?? 0,
        reach: summary.reach ?? 0, frequency: summary.frequency ?? 0,
      },
      promotedPostCount: promoted.length,
      promotedSpend90d: Math.round(promoted.reduce((s, p) => s + (p.spend ?? 0), 0)),
      diagnosisCounts: snap.diagnosisCounts ?? { critical: 0, warning: 0 },
      audience,
      // IG account follower demographics (organic audience) — written by cron.
      igAudience: snap.igFollowerDemographics ?? null,
      trend,
      rangedSummary,
      posts,
    }
  }))

  return NextResponse.json({ pages: rows, range: { from, to } })
}
