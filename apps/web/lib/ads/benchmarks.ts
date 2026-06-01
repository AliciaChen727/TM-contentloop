// Industry benchmark reference values for the diagnosis Agent (Phase 3).
//
// These are *comparison references*, NOT trigger thresholds. Trigger thresholds
// live only in diagnosis.ts / contentDiagnosis.ts (CLAUDE.md single-source rule).
// The Agent uses these to write "你的 CTR 0.20%，同業平均 1.4–2.2%" style sentences.
//
// Vertical: Toastmasters 分會 = 非營利 / 教育 / 活動報名. Values are conservative
// ranges drawn from public 2025/2026 Meta ad + organic-engagement benchmark
// reports. Sources: see docs/phase-3-diagnosis-agent.md.

export const META_AD_BENCHMARKS = {
  // Healthy all-industry Facebook ad CTR sits around 1.4–2.2% (median ~2.19%).
  ctr: { low: 1.4, mid: 1.9, high: 2.2, unit: '%' },
  // Traffic-objective CPC ~ $0.70; lead-gen CPC ~ $1.92 (2025).
  cpcTraffic: { good: 0.70, unit: 'USD' },
  cpcLead: { good: 1.92, unit: 'USD' },
  // Nonprofit CPC averaged ~$0.39 across 2025 (low $0.28 Jan, high $0.54 Nov).
  nonprofitCpc: { avg: 0.39, low: 0.28, high: 0.54, unit: 'USD' },
  // Education / local-services CPM often falls under $8 off-peak.
  cpmLow: { under: 8, unit: 'USD' },
} as const

export const ORGANIC_ENGAGEMENT_BENCHMARKS = {
  // Facebook organic engagement rate 0.06–0.2%; Instagram 0.45–0.6% (2025).
  facebook: { low: 0.06, high: 0.2, unit: '%' },
  instagram: { low: 0.45, high: 0.6, unit: '%' },
  // Instagram by format (Q1 2026, %): carousels > reels > single image.
  igByFormat: { carousel: 0.52, reels: 0.50, singleImage: 0.35 },
} as const

// Organic reach/engagement fell sharply in 2025 (FB engagement −36%, IG −24%
// YoY). Agent copy should reassure the user that a low organic rate is the new
// normal, not a sign they did something wrong.
export const ORGANIC_DECLINE_2025 = { facebookEngagement: -36, instagramEngagement: -24, unit: '%' } as const

// Format a one-line CTR comparison sentence for a given account CTR (%).
export function ctrBenchmarkLine(ctr: number): string {
  const b = META_AD_BENCHMARKS.ctr
  const verdict = ctr >= b.mid ? '達同業水準' : ctr >= b.low ? '接近同業低標' : '低於同業平均'
  return `你的 CTR ${ctr.toFixed(2)}%，同業（非營利/教育）健康區間約 ${b.low}–${b.high}%（${verdict}）。`
}

// Format a one-line organic engagement comparison sentence.
export function engagementBenchmarkLine(rate: number, platform: 'facebook' | 'instagram'): string {
  const b = ORGANIC_ENGAGEMENT_BENCHMARKS[platform]
  const label = platform === 'facebook' ? 'Facebook' : 'Instagram'
  const verdict = rate >= b.high ? '高於同業' : rate >= b.low ? '落在同業區間' : '低於同業區間'
  return `${label} 自然互動率 ${rate.toFixed(2)}%，同業約 ${b.low}–${b.high}%（${verdict}）。`
}
