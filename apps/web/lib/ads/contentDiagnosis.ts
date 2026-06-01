// Content (post) diagnosis rules — Phase 3, Layer 1 (rules only, no model).
// Parallel to lib/ads/diagnosis.ts but for organic FB/IG posts. Pure functions,
// page-scoped input (the caller must pass posts already isolated to one pageId —
// see CLAUDE.md 跨頁隔離). Output DiagItem[] with a `content_*` type prefix so the
// Agent + consumers can tell ad vs content cards apart without changing DiagItem.
//
// Engagement rate here is REACH-BASED ((likes+comments+shares)/reach), matching
// the dashboard's own definition. NOTE: this is NOT comparable to the
// follower-based industry benchmarks in benchmarks.ts (different denominator), so
// content rules stay self-relative (median / P75 / trend) rather than quoting
// those numbers. See docs/phase-3-diagnosis-agent.md.

import type { DiagItem, Post } from '@/components/ads/types'

// Reuse the dashboard's reach-based engagement-rate formula (page.tsx).
export function postEngagementRate(p: Post): number | null {
  if (!p.reach || p.reach <= 0) return null
  return parseFloat(((p.likes + p.comments + p.shares) / p.reach * 100).toFixed(2))
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length))
  return s[idx]
}

interface ScoredPost { post: Post; er: number }

// Build content diagnosis items from a page-scoped, date-filtered post list.
export function buildContentDiagnosis(posts: Post[]): DiagItem[] {
  const items: DiagItem[] = []
  const scored: ScoredPost[] = posts
    .map((post) => ({ post, er: postEngagementRate(post) }))
    .filter((s): s is ScoredPost => s.er !== null)

  // Need a meaningful sample before judging organic performance.
  if (scored.length < 3) return items

  const ers = scored.map((s) => s.er)
  const med = median(ers)
  const p75 = percentile(ers, 75)

  // C1 — 最佳貼文值得加碼: highest-ER post that beats P75 AND is ≥1.5× median
  // (hybrid threshold) AND has no ad behind it yet. One card, the single best.
  const boostCandidates = scored
    .filter((s) => s.er >= p75 && s.er >= med * 1.5 && !s.post.hasAd)
    .sort((a, b) => b.er - a.er)
  if (boostCandidates.length > 0) {
    const { post, er } = boostCandidates[0]
    const beats = Math.round((ers.filter((e) => e <= er).length / ers.length) * 100)
    items.push({
      id: 'c1', severity: 'good', type: 'content_boost', title: '最佳貼文值得加碼推廣',
      desc: `「${post.title.slice(0, 25)}」自然互動率 ${er.toFixed(2)}%，是你近期最佳（贏過 ${beats}% 貼文），但還沒投過廣告。建議 boost 這篇，把已驗證的好內容推給更多人。`,
      adset: post.title.slice(0, 30), metric: `互動率 ${er.toFixed(2)}%`,
      threshold: `贏過 ${beats}% 貼文`, action: '對這篇貼文投放廣告（加碼推廣）',
      storyId: post.id,
    })
  }

  // C2 — 近期互動下滑: split by recency (newer half vs older half). Warn when the
  // recent median drops ≥30% vs the earlier median. Self-relative, unit-safe.
  if (scored.length >= 6) {
    const byDate = [...scored].sort((a, b) => a.post.date.localeCompare(b.post.date))
    const half = Math.floor(byDate.length / 2)
    const olderMed = median(byDate.slice(0, half).map((s) => s.er))
    const recentMed = median(byDate.slice(half).map((s) => s.er))
    if (olderMed > 0 && recentMed < olderMed * 0.7) {
      const drop = Math.round((1 - recentMed / olderMed) * 100)
      items.push({
        id: 'c2', severity: 'warning', type: 'content_low_engagement', title: '近期貼文互動下滑',
        desc: `近期貼文自然互動率中位數 ${recentMed.toFixed(2)}%，比先前的 ${olderMed.toFixed(2)}% 下滑約 ${drop}%。建議檢視近期內容主題與形式，回到先前表現較好的方向。`,
        adset: '整體內容', metric: `中位數 ${recentMed.toFixed(2)}%`,
        threshold: `較先前 -${drop}%`, action: '檢視近期內容主題 / 參考過往高互動貼文',
      })
    }
  }

  // C3 — 發文頻率偏低: cadence over the post window. < 1 post / 7 days (avg) on a
  // window of at least 14 days reads as too sparse to build momentum.
  const dates = posts.map((p) => p.date).filter(Boolean).sort()
  if (dates.length >= 1) {
    const first = new Date(dates[0]).getTime()
    const last = new Date(dates[dates.length - 1]).getTime()
    const spanDays = Math.max(1, Math.round((last - first) / 86400000))
    const perWeek = posts.length / (spanDays / 7)
    if (spanDays >= 14 && perWeek < 1) {
      items.push({
        id: 'c3', severity: 'good', type: 'content_cadence', title: '發文頻率偏低',
        desc: `這段期間平均每週發文 ${perWeek.toFixed(1)} 篇，頻率偏低不利於累積觸及與互動。建議維持每週至少 1–2 篇穩定發布。`,
        adset: '整體內容', metric: `每週 ${perWeek.toFixed(1)} 篇`,
        threshold: '建議 ≥ 1–2 篇/週', action: '建立固定發文節奏（每週 1–2 篇）',
      })
    }
  }

  return items
}
