export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

import { VALID_GOALS, VALID_INDUSTRIES, type Industry, type OptimizationGoal } from '@/lib/profile-types'

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const snap = await adminDb.collection('users').doc(uid).get()
  const data = snap.data()
  return NextResponse.json({
    completed: data?.onboardingCompleted === true,
    data: data?.onboardingData ?? null,
  })
}

interface PostBody {
  skip?: boolean
  optimizationGoal?: OptimizationGoal | null
  industry?: Industry | null
  industryOther?: string | null
  brandName?: string | null
  extraContext?: string | null
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: PostBody = await req.json()

  if (body.skip) {
    await adminDb.collection('users').doc(uid).set({
      onboardingCompleted: true,
      onboardingUpdatedAt: FieldValue.serverTimestamp(),
      onboardingData: null,
    }, { merge: true })
    return NextResponse.json({ success: true })
  }

  // Patch semantics: any provided field merges into onboardingData; null clears
  // the field. Useful for both first-time onboarding (sends goal+industry) and
  // settings page edits (sends brandName/extraContext alone).
  const patch: Record<string, unknown> = {}

  if (body.optimizationGoal !== undefined) {
    if (body.optimizationGoal === null) {
      patch.optimizationGoal = null
    } else if (VALID_GOALS.includes(body.optimizationGoal)) {
      patch.optimizationGoal = body.optimizationGoal
    } else {
      return NextResponse.json({ error: 'Invalid optimizationGoal' }, { status: 400 })
    }
  }
  if (body.industry !== undefined) {
    if (body.industry === null) {
      patch.industry = null
    } else if (VALID_INDUSTRIES.includes(body.industry)) {
      patch.industry = body.industry
    } else {
      return NextResponse.json({ error: 'Invalid industry' }, { status: 400 })
    }
  }
  if (body.industryOther !== undefined) patch.industryOther = body.industryOther ?? null
  if (body.brandName !== undefined) patch.brandName = body.brandName ?? null
  if (body.extraContext !== undefined) patch.extraContext = body.extraContext ?? null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // First-write completedAt; subsequent edits update onboardingUpdatedAt only.
  const existing = await adminDb.collection('users').doc(uid).get()
  const hasExistingData = !!existing.data()?.onboardingData
  if (!hasExistingData) patch.completedAt = FieldValue.serverTimestamp()

  // Merge nested field — must use dot-path to avoid clobbering other fields.
  const update: Record<string, unknown> = {
    onboardingCompleted: true,
    onboardingUpdatedAt: FieldValue.serverTimestamp(),
  }
  for (const [k, v] of Object.entries(patch)) {
    update[`onboardingData.${k}`] = v
  }

  await adminDb.collection('users').doc(uid).update(update).catch(async () => {
    // doc may not exist yet — fall back to set with merge
    const seed: Record<string, unknown> = {
      onboardingCompleted: true,
      onboardingUpdatedAt: FieldValue.serverTimestamp(),
      onboardingData: patch,
    }
    await adminDb.collection('users').doc(uid).set(seed, { merge: true })
  })

  return NextResponse.json({ success: true })
}
