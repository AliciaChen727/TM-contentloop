// Industry benchmarks for social / ad performance comparison.
// Sources: Rival IQ & Sprout Social 2024 Industry Benchmark Reports + Meta Ads
// benchmarks for Taiwan/Asia. Organic-engagement values are directional and
// scaled to this dashboard's engagement-rate definition — adjust as real data
// accumulates.

import type { Industry } from './profile-types'

export interface IndustryBenchmark {
  label: string
  fb: { engagementRate: number; reachRate: number; followerGrowthMonthly: number }
  ig: { engagementRate: number; reachRate: number; followerGrowthMonthly: number }
}

// Default base = non-profit / community. Kept for backward compatibility and as
// the fallback when a page hasn't set its industry yet.
export const BENCHMARKS = {
  industry: '非營利組織 / 社群',
  fb: {
    engagementRate: 0.60,       // % organic engagement rate
    reachRate: 8.0,              // % reach / followers per post
    followerGrowthMonthly: 0.5, // % per month
  },
  ig: {
    engagementRate: 1.5,
    reachRate: 12.0,
    followerGrowthMonthly: 1.0,
  },
}

// Per-industry organic engagement benchmarks (FB + IG).
export const INDUSTRY_BENCHMARKS: Record<Industry, IndustryBenchmark> = {
  // 課程業 / 高教 IG 互動偏高、FB 中等
  education: {
    label: '課程 / 教育訓練',
    fb: { engagementRate: 0.55, reachRate: 7.0, followerGrowthMonthly: 0.4 },
    ig: { engagementRate: 1.8, reachRate: 13.0, followerGrowthMonthly: 0.8 },
  },
  // 電商促銷導向、自然互動率偏低（多靠廣告）
  ecommerce: {
    label: '電商 / 零售',
    fb: { engagementRate: 0.35, reachRate: 6.0, followerGrowthMonthly: 0.6 },
    ig: { engagementRate: 0.9, reachRate: 9.0, followerGrowthMonthly: 1.0 },
  },
  // 活動 / 社群組織（與非營利相近）
  event: {
    label: '活動 / 社群組織',
    fb: { engagementRate: 0.60, reachRate: 8.0, followerGrowthMonthly: 0.5 },
    ig: { engagementRate: 1.5, reachRate: 12.0, followerGrowthMonthly: 1.0 },
  },
  // 個人品牌 / 創作者，受眾黏著度高、互動率最高
  personal_brand: {
    label: '個人品牌 / 自媒體',
    fb: { engagementRate: 0.80, reachRate: 10.0, followerGrowthMonthly: 0.8 },
    ig: { engagementRate: 2.2, reachRate: 16.0, followerGrowthMonthly: 1.5 },
  },
  // 自由填寫產業：沿用 base 數值，實際同業比較交由洞察報告 LLM 依該產業給出
  other: {
    label: '其他',
    fb: BENCHMARKS.fb,
    ig: BENCHMARKS.ig,
  },
}

// Resolve the active benchmark set for a page's industry.
// - industry null/unset → base (non-profit) values, isSet=false (UI prompts user to set it)
// - industry==='other' with free text → use the user's own label, base values
export function getBenchmarkByIndustry(
  industry: Industry | null | undefined,
  industryOther?: string | null,
): { label: string; fb: IndustryBenchmark['fb']; ig: IndustryBenchmark['ig']; isSet: boolean } {
  if (!industry) {
    return { label: '未設定（暫用非營利組織 / 社群預設）', fb: BENCHMARKS.fb, ig: BENCHMARKS.ig, isSet: false }
  }
  const b = INDUSTRY_BENCHMARKS[industry] ?? INDUSTRY_BENCHMARKS.other
  if (industry === 'other' && industryOther?.trim()) {
    return { label: industryOther.trim(), fb: b.fb, ig: b.ig, isSet: true }
  }
  return { label: b.label, fb: b.fb, ig: b.ig, isSet: true }
}

// Goal-specific ad benchmarks (Taiwan/Asia market)
// CPC/CPM in TWD (NT$), matching the values shown in 廣告目標設定 / 總覽 dashboard.
// Ad cost is driven primarily by the campaign objective, so these stay goal-based.
const GOAL_BENCHMARKS: Record<string, { ctr: number; cpc: number; cpm: number; label: string }> = {
  clicks:     { ctr: 1.8, cpc: 280, cpm: 150, label: '提升點擊率' },
  conversion: { ctr: 1.5, cpc: 300, cpm: 120, label: '提升轉換與ROI' },
  reach:      { ctr: 0.9, cpc: 500, cpm:  80, label: '擴大品牌觸及' },
  event:      { ctr: 1.8, cpc: 280, cpm: 130, label: '活動報名推廣' },
}

export function getBenchmarkByGoal(goal: string) {
  return GOAL_BENCHMARKS[goal] ?? GOAL_BENCHMARKS['clicks']
}

export type Benchmark = typeof BENCHMARKS
