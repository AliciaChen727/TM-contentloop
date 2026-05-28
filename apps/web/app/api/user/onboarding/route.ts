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

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: { optimizationGoal?: OptimizationGoal | null; industry?: Industry | null; skip?: boolean } = await req.json()

  const update: Record<string, unknown> = {
    onboardingCompleted: true,
    onboardingUpdatedAt: FieldValue.serverTimestamp(),
  }

  if (body.skip) {
    update.onboardingData = null
  } else {
    if (!body.optimizationGoal || !VALID_GOALS.includes(body.optimizationGoal)) {
      return NextResponse.json({ error: 'Invalid optimizationGoal' }, { status: 400 })
    }
    if (!body.industry || !VALID_INDUSTRIES.includes(body.industry)) {
      return NextResponse.json({ error: 'Invalid industry' }, { status: 400 })
    }
    update.onboardingData = {
      optimizationGoal: body.optimizationGoal,
      industry: body.industry,
      completedAt: FieldValue.serverTimestamp(),
    }
  }

  await adminDb.collection('users').doc(uid).set(update, { merge: true })
  return NextResponse.json({ success: true })
}
