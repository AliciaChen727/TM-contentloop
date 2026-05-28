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

// Verify this uid is a registered admin for the page. Mirrors the gate used in
// ads/labels, ads/abtest, etc. — page-level data must stay isolated per
// CLAUDE.md page-isolation rules.
async function verifyPageAdmin(uid: string, pageId: string): Promise<boolean> {
  const snap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return snap.exists
}

export async function GET(req: NextRequest, { params }: { params: { pageId: string } }) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = params
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await verifyPageAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('profile').doc('profile').get()
  const data = snap.data() ?? {}
  return NextResponse.json({
    optimizationGoal: data.optimizationGoal ?? null,
    industry: data.industry ?? null,
    industryOther: data.industryOther ?? null,
    brandName: data.brandName ?? null,
    extraContext: data.extraContext ?? null,
    updatedBy: data.updatedBy ?? null,
  })
}

export async function POST(req: NextRequest, { params }: { params: { pageId: string } }) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId } = params
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await verifyPageAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body: {
    optimizationGoal?: OptimizationGoal | null
    industry?: Industry | null
    industryOther?: string | null
    brandName?: string | null
    extraContext?: string | null
  } = await req.json()
  const update: Record<string, unknown> = { updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }

  if (body.optimizationGoal !== undefined) {
    if (body.optimizationGoal === null) {
      update.optimizationGoal = FieldValue.delete()
    } else if (VALID_GOALS.includes(body.optimizationGoal)) {
      update.optimizationGoal = body.optimizationGoal
    } else {
      return NextResponse.json({ error: 'Invalid optimizationGoal' }, { status: 400 })
    }
  }
  if (body.industry !== undefined) {
    if (body.industry === null) {
      update.industry = FieldValue.delete()
    } else if (VALID_INDUSTRIES.includes(body.industry)) {
      update.industry = body.industry
    } else {
      return NextResponse.json({ error: 'Invalid industry' }, { status: 400 })
    }
  }
  if (body.industryOther !== undefined) {
    update.industryOther = body.industryOther === null ? FieldValue.delete() : body.industryOther
  }
  if (body.brandName !== undefined) {
    update.brandName = body.brandName === null ? FieldValue.delete() : body.brandName
  }
  if (body.extraContext !== undefined) {
    update.extraContext = body.extraContext === null ? FieldValue.delete() : body.extraContext
  }

  await adminDb.collection('pages').doc(pageId).collection('profile').doc('profile').set(update, { merge: true })
  return NextResponse.json({ success: true })
}
