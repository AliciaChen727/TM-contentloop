// Resolves the active profile (industry + optimization goal + brand + extra
// context) for a (user, page) pair.
//
// Priority:
//   1. Page-level override        — pages/{pageId}/profile/profile
//   2. User-level onboarding      — users/{uid}.onboardingData
//   3. Legacy organizationContext — users/{uid}/settings/preferences (read-only)
//
// Page-level override lets one admin manage multiple pages across different
// industries — each page can declare its own profile and the user-level
// onboarding is only the fallback default.

import { adminDb } from '@/lib/firebase/admin'
import type { Industry, OptimizationGoal, ResolvedProfile } from '@/lib/profile-types'

interface ProfileDoc {
  optimizationGoal?: OptimizationGoal
  industry?: Industry
  industryOther?: string
  brandName?: string
  extraContext?: string
}

interface LegacyOrgCtx {
  name?: string
  type?: string
  coreKpi?: string
  extraContext?: string
}

function hasAnyProfileField(d: ProfileDoc | null | undefined): boolean {
  if (!d) return false
  return !!(d.optimizationGoal || d.industry || d.industryOther || d.brandName || d.extraContext)
}

function shape(d: ProfileDoc, source: ResolvedProfile['source']): ResolvedProfile {
  return {
    optimizationGoal: d.optimizationGoal ?? null,
    industry: d.industry ?? null,
    industryOther: d.industryOther ?? null,
    brandName: d.brandName ?? null,
    extraContext: d.extraContext ?? null,
    source,
  }
}

export async function resolvePageProfile(uid: string, pageId: string | null | undefined): Promise<ResolvedProfile> {
  // 1. Page-level override
  if (pageId) {
    try {
      const snap = await adminDb.collection('pages').doc(pageId).collection('profile').doc('profile').get()
      const data = snap.data() as ProfileDoc | undefined
      if (hasAnyProfileField(data)) return shape(data!, 'page')
    } catch {
      // fall through
    }
  }

  // 2. User-level onboarding
  try {
    const userSnap = await adminDb.collection('users').doc(uid).get()
    const onb = userSnap.data()?.onboardingData as ProfileDoc | null | undefined
    if (hasAnyProfileField(onb)) return shape(onb!, 'user')
  } catch {
    // fall through
  }

  // 3. Legacy organizationContext (read-only compat for users who set up the old card)
  try {
    const prefSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
    const legacy = prefSnap.data()?.organizationContext as LegacyOrgCtx | null | undefined
    if (legacy && (legacy.name || legacy.type || legacy.extraContext)) {
      return {
        optimizationGoal: null,
        industry: null,
        industryOther: null,
        brandName: legacy.name ?? null,
        extraContext: [legacy.type, legacy.coreKpi, legacy.extraContext].filter(Boolean).join('；') || null,
        source: 'user',
      }
    }
  } catch {
    // fall through
  }

  return { optimizationGoal: null, industry: null, industryOther: null, brandName: null, extraContext: null, source: 'none' }
}
