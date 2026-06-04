// Ad diagnosis engine — the SINGLE source of truth for the 診斷建議 page, the
// in-app notification 紅點, and the alert email. Pure functions, no React / client
// deps, so it runs identically on the client (buildAdData) and the server (sync
// cron + processAlerts). See docs/phase-2-notification-center.md.

import type { DiagItem } from '@/components/ads/types'
import type { AlertItem } from '@/lib/alerts/types'
import { parseActionValue } from '@/lib/meta/purchaseActions'

export function inferCreativeType(name: string): string {
  if (/reels/i.test(name)) return 'Reels'
  if (/stories|story/i.test(name)) return 'Stories'
  if (/海報/.test(name)) return '海報'
  return '貼文'
}

export function inferThumb(type: string): 'reels' | 'post' | 'stories' | 'poster' {
  if (type === 'Reels') return 'reels'
  if (type === 'Stories') return 'stories'
  if (type === '海報') return 'poster'
  return 'post'
}

export function inferStatus(roas: number): 'top' | 'good' | 'ok' | 'bad' {
  if (roas >= 4) return 'top'
  if (roas >= 3) return 'good'
  if (roas >= 1.5) return 'ok'
  return 'bad'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRawAdCreative(c: any, idx: number) {
  const spend = parseFloat(c.spend ?? '0')
  const impressions = parseInt(c.impressions ?? '0')
  const ctr = parseFloat(c.ctr ?? '0')
  const actions: { action_type: string; value: string }[] = c.actions ?? []
  const actionValues: { action_type: string; value: string }[] = c.action_values ?? []
  const purchases = parseActionValue(actions, 'purchase')          // alias-aware
  const linkClicks = parseFloat(actions.find(a => a.action_type === 'link_click')?.value ?? '0')
  const videoViews = parseFloat(actions.find(a => a.action_type === 'video_view')?.value ?? '0')
  const revenue = parseActionValue(actionValues, 'purchase')       // alias-aware
  const hasPurchase = purchases > 0
  const primaryMetric = hasPurchase ? revenue : linkClicks > 0 ? linkClicks : videoViews
  // For non-revenue accounts (e.g. D67 non-profit), ROAS is meaningless.
  // Instead, compute a "Click Efficiency Score" = link_clicks / spend * 100
  // which represents "how many clicks per $1 spent × 100".
  // If purchases exist, use real ROAS. Otherwise use click efficiency score.
  const clickEfficiency = spend > 0 && linkClicks > 0
    ? parseFloat((linkClicks / spend * 100).toFixed(2))
    : 0
  const roas = spend > 0 && primaryMetric > 0
    ? (hasPurchase
        ? parseFloat((primaryMetric / spend).toFixed(2))   // Real ROAS for e-commerce
        : clickEfficiency)                                  // Click efficiency score for non-profit
    : 0
  const cpa = primaryMetric > 0 ? parseFloat((spend / primaryMetric).toFixed(2)) : 0
  const postTitle = c.post_title ? (c.post_title as string).slice(0, 60) : null
  const type = inferCreativeType(c.ad_name ?? '')
  const storyId = (c.effective_object_story_id as string | undefined) ?? null
  return {
    id: c.ad_id ?? String(idx),
    name: postTitle ?? c.ad_name ?? `廣告 ${idx + 1}`,
    type,
    channel: 'Meta',
    spend,
    impressions,
    ctr,
    roas,
    cpa,
    thumb: inferThumb(type),
    status: inferStatus(roas),
    linkClicks: linkClicks > 0 ? linkClicks : 0,
    cpc: linkClicks > 0 ? parseFloat((spend / linkClicks).toFixed(2)) : 0,
    adName: c.ad_name ?? '',
    campaignName: c.campaign_name ?? '',
    budget: typeof c.budget === 'number' ? c.budget : 0,
    thumbnailUrl: (c.thumbnail_url as string | undefined) ?? null,
    storyId,
  }
}

export function buildDiagnosis(s: Record<string, number>, creatives: ReturnType<typeof mapRawAdCreative>[], budget: number): DiagItem[] {
  const items: DiagItem[] = []

  if ((s.frequency ?? 0) > 3.5) {
    items.push({ id: 'd1', severity: 'critical', type: 'audience_fatigue', title: '受眾疲乏警告',
      desc: `整體帳戶頻率已達 ${(s.frequency).toFixed(2)}，建議暫停或更換素材。`,
      adset: '整體帳戶', metric: `Frequency ${(s.frequency).toFixed(2)}`, threshold: '> 3.5', action: '更換素材 / 擴大受眾' })
  }

  // For non-profit accounts (no revenue): skip ROAS warning entirely.
  // Instead, warn if CPL (cost per link click) is high (> $10 per click).
  const cpl = (s.conversions ?? 0) > 0 ? (s.spend ?? 0) / (s.conversions ?? 1) : 0
  if ((s.spend ?? 0) > 0 && (s.conversions ?? 0) === 0) {
    items.push({ id: 'd2', severity: 'warning', type: 'low_roas', title: '尚無點擊轉換數據',
      desc: '目前未偵測到報名連結點擊數據，建議確認廣告目標是否設為「流量」或「互動」。',
      adset: '整體帳戶', metric: '轉換數 0', threshold: '需 > 0', action: '檢查廣告目標設定 / 確認連結正確' })
  } else if (cpl > 10 && (s.spend ?? 0) > 0) {
    items.push({ id: 'd2', severity: 'warning', type: 'low_roas', title: 'CPL 偏高',
      desc: `每次點擊報名連結成本為 $${cpl.toFixed(2)}，建議優化素材或縮小受眾。`,
      adset: '整體帳戶', metric: `CPL $${cpl.toFixed(2)}`, threshold: '建議 < $10', action: '優化 CTA 文案 / 縮小受眾' })
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
      adset: lowCtr.name.slice(0, 30), metric: `CTR ${lowCtr.ctr.toFixed(2)}%`, threshold: '< 1.5%', action: '更換廣告文案或素材',
      thumbnailUrl: lowCtr.thumbnailUrl, storyId: lowCtr.storyId })
  } else if ((s.impressions ?? 0) > 0 && (s.ctr ?? 0) < 1.5) {
    // Has impressions but low/zero CTR. CTR===0 = real "no clicks at all" problem,
    // NOT "good" — the old `ctr > 0` guard wrongly let it fall through to 帳戶表現良好.
    const c = s.ctr ?? 0
    items.push({ id: 'd4', severity: 'warning', type: 'low_ctr',
      title: c === 0 ? '廣告完全沒有點擊' : 'CTR 偏低',
      desc: c === 0
        ? `這段期間廣告有 ${Math.round(s.impressions).toLocaleString('zh-TW')} 次曝光，但完全沒有人點擊（CTR 0%）。建議檢查廣告文案／CTA 與連結是否正常。`
        : `整體 CTR 僅 ${c.toFixed(2)}%，低於建議值 1.5%。`,
      adset: '整體帳戶', metric: `CTR ${c.toFixed(2)}%`, threshold: '< 1.5%',
      action: c === 0 ? '檢查 CTA 文案 / 連結是否有效' : '更換廣告文案或素材' })
  }

  const top = [...creatives].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas)[0]
  if (top && top.roas >= 5) {
    items.push({ id: 'd5', severity: 'good', type: 'top_performer', title: '最佳點擊效率素材',
      desc: `素材「${top.name.slice(0, 25)}」點擊效率達 ${top.roas.toFixed(1)}x，建議增加預算。`,
      adset: top.name.slice(0, 30), metric: `點擊效率 ${top.roas.toFixed(1)}`, threshold: '目標 > 5', action: `增加預算 20-30%`,
      thumbnailUrl: top.thumbnailUrl, storyId: top.storyId })
  }

  if (items.length === 0) {
    // No rule fired. Distinguish "no ad activity at all" from "genuinely healthy" —
    // CTR 0% with zero spend/impressions means there's just no data, not good news.
    const noActivity = (s.spend ?? 0) <= 0 && (s.impressions ?? 0) <= 0
    if (noActivity) {
      items.push({ id: 'd0', severity: 'good', type: 'top_performer', title: '尚無廣告數據',
        desc: '這個區間沒有偵測到廣告投放（花費與曝光皆為 0）。若有投放中的廣告，請確認已連結 Meta 廣告帳號，或切換到有投放的日期區間再看診斷。',
        adset: '整體帳戶', metric: '無投放數據', threshold: '—', action: '確認廣告帳號連結 / 調整日期區間' })
    } else {
      items.push({ id: 'd0', severity: 'good', type: 'top_performer', title: '帳戶表現良好',
        desc: `CTR ${(s.ctr ?? 0).toFixed(2)}%，點擊效益正常，各項指標正常。`,
        adset: '整體帳戶', metric: `CTR ${(s.ctr ?? 0).toFixed(2)}%`, threshold: '正常', action: '持續監控，維持現況' })
    }
  }

  return items
}

// Compute diagnosis from a stored adInsights/latest snapshot (server-side).
// The snapshot carries `summary` and raw `adCreatives` — the same inputs the
// client feeds buildDiagnosis — so the result matches the 診斷建議 page's rules.
export function computeDiagnosisFromSnapshot(
  snap: Record<string, unknown> | undefined | null,
): { items: DiagItem[]; criticalCount: number; warningCount: number } {
  const summary = ((snap?.summary ?? {}) as Record<string, number>)
  const rawCreatives = Array.isArray(snap?.adCreatives) ? (snap!.adCreatives as unknown[]) : []
  const creatives = rawCreatives.map((c, i) => mapRawAdCreative(c, i))
  const budget = typeof summary.budget === 'number' ? summary.budget : 0
  const items = buildDiagnosis(summary, creatives, budget)
  return {
    items,
    criticalCount: items.filter(d => d.severity === 'critical').length,
    warningCount: items.filter(d => d.severity === 'warning').length,
  }
}

const SEVERITY_EMOJI: Record<'critical' | 'warning', string> = { critical: '🚨', warning: '⚠️' }

// Convert diagnosis items into the unified alert representation used by the
// email + in-app notification sinks. Only critical/warning items become alerts
// (good/optimization items don't trigger the 紅點).
export function diagnosisToAlertItems(items: DiagItem[]): AlertItem[] {
  return items
    .filter((d): d is DiagItem & { severity: 'critical' | 'warning' } => d.severity === 'critical' || d.severity === 'warning')
    .map((d) => ({
      severity: d.severity,
      emoji: SEVERITY_EMOJI[d.severity],
      title: d.title,
      message: d.desc,
      advice: d.action,
      key: `${d.type}_${d.id}`,
    }))
}
