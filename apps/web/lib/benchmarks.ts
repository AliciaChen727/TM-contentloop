// Industry benchmarks for non-profit / community organizations.
// Source: Sprout Social Industry Benchmarks 2024, Rival IQ Social Media Industry Report.
// Update annually or when targeting a different industry.

export const BENCHMARKS = {
  industry: '非營利組織 / 社群',
  fb: {
    engagementRate: 0.60,    // % (reactions+comments+shares) / reach
    reachRate: 8.0,           // % reach / followers per post
    followerGrowthMonthly: 0.5, // % per month
    ctr: 1.2,                 // % ad CTR
    cpm: 8.0,                 // USD ad CPM
    videoViewRate: 25.0,      // % of reach that views video
  },
  ig: {
    engagementRate: 1.5,     // % (likes+comments+saves) / reach
    reachRate: 12.0,          // %
    followerGrowthMonthly: 1.0, // % per month
    ctr: 0.9,                 // % ad CTR
    videoViewRate: 30.0,      // %
  },
}

export type Benchmark = typeof BENCHMARKS
