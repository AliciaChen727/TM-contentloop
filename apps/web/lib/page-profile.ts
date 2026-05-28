// Resolves the active industry + optimization goal for a (user, page) pair.
// Priority: page-level override (pages/{pageId}) → user-level default (users/{uid}.onboardingData) → none.
//
// Page-level override lets one admin manage multiple pages across different
// industries — each page can declare its own profile and the user-level
// onboarding is only the fallback default.

import { adminDb } from '@/lib/firebase/admin'
import type { Industry, OptimizationGoal, ResolvedProfile } from '@/lib/profile-types'

interface PageProfileDoc {
  optimizationGoal?: OptimizationGoal
  industry?: Industry
}

interface UserOnboardingDoc {
  optimizationGoal?: OptimizationGoal
  industry?: Industry
}

export async function resolvePageProfile(uid: string, pageId: string | null | undefined): Promise<ResolvedProfile> {
  // Page-level override
  if (pageId) {
    try {
      const snap = await adminDb.collection('pages').doc(pageId).collection('profile').doc('profile').get()
      const data = snap.data() as PageProfileDoc | undefined
      if (data?.optimizationGoal || data?.industry) {
        return {
          optimizationGoal: data.optimizationGoal ?? null,
          industry: data.industry ?? null,
          source: 'page',
        }
      }
    } catch {
      // fall through to user-level
    }
  }

  // User-level default (from onboarding)
  try {
    const userSnap = await adminDb.collection('users').doc(uid).get()
    const onb = userSnap.data()?.onboardingData as UserOnboardingDoc | null | undefined
    if (onb?.optimizationGoal || onb?.industry) {
      return {
        optimizationGoal: onb.optimizationGoal ?? null,
        industry: onb.industry ?? null,
        source: 'user',
      }
    }
  } catch {
    // fall through to none
  }

  return { optimizationGoal: null, industry: null, source: 'none' }
}
