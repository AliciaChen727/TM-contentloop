// Industry benchmarks for non-profit / community / event organizations.
// Source: Sprout Social Industry Benchmarks 2024, Meta Ads benchmarks for Taiwan/Asia.

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

// Goal-specific ad benchmarks (Taiwan/Asia market)
const GOAL_BENCHMARKS: Record<string, { ctr: number; cpc: number; cpm: number; label: string }> = {
  clicks:     { ctr: 1.8, cpc: 2.8,  cpm: 5.0,  label: '提升點擊率' },
  conversion: { ctr: 1.5, cpc: 3.5,  cpm: 4.5,  label: '提升轉換與ROI' },
  reach:      { ctr: 0.9, cpc: 6.0,  cpm: 2.5,  label: '擴大品牌觸及' },
  event:      { ctr: 1.8, cpc: 2.8,  cpm: 4.5,  label: '活動報名推廣' },
}

export function getBenchmarkByGoal(goal: string) {
  return GOAL_BENCHMARKS[goal] ?? GOAL_BENCHMARKS['clicks']
}

export type Benchmark = typeof BENCHMARKS
