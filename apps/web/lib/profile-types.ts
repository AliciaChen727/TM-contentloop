// Shared profile types used by both user-level onboarding and page-level overrides.
// Keep this in lockstep with /api/user/onboarding and /api/pages/[pageId]/profile.

export type OptimizationGoal = 'clicks' | 'conversion' | 'reach' | 'event'
export type Industry = 'ecommerce' | 'education' | 'event' | 'personal_brand' | 'other'

export const VALID_GOALS: OptimizationGoal[] = ['clicks', 'conversion', 'reach', 'event']
export const VALID_INDUSTRIES: Industry[] = ['ecommerce', 'education', 'event', 'personal_brand', 'other']

export interface ProfileFields {
  optimizationGoal: OptimizationGoal
  industry: Industry
  // Free-text describing the actual industry when `industry === 'other'`.
  industryOther?: string
  // Brand / org name + extra context — merged here from the legacy
  // organizationContext schema on users/{uid}/settings/preferences.
  brandName?: string
  extraContext?: string
}

// Source tells callers whether the resolved profile came from the page doc,
// the user doc, or neither. Useful for UI to show "using user default" vs
// "page override active".
export type ProfileSource = 'page' | 'user' | 'none'

export interface ResolvedProfile {
  optimizationGoal: OptimizationGoal | null
  industry: Industry | null
  industryOther: string | null
  brandName: string | null
  extraContext: string | null
  source: ProfileSource
}

// Effective industry label for prompts/UI: prefer industryOther when industry === 'other'.
export function effectiveIndustryLabel(industry: Industry | null, industryOther: string | null): string | null {
  if (!industry) return null
  if (industry === 'other' && industryOther?.trim()) return industryOther.trim()
  return INDUSTRY_LABEL_ZH[industry]
}

export const GOAL_LABEL_ZH: Record<OptimizationGoal, string> = {
  clicks: '提升點擊率',
  conversion: '提升轉換與 ROI',
  reach: '擴大品牌觸及',
  event: '活動報名推廣',
}

export const INDUSTRY_LABEL_ZH: Record<Industry, string> = {
  ecommerce: '電商 / 零售',
  education: '課程 / 教育訓練',
  event: '活動 / 社群組織',
  personal_brand: '個人品牌 / 自媒體',
  other: '其他',
}
