export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

async function hasPageAccess(uid: string, pageId: string): Promise<boolean> {
  const memberSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (memberSnap.exists) return true
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
  return viewerPages.some(p => p.pageId === pageId)
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  if (!(await hasPageAccess(uid, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const snap = await adminDb.collection('pages').doc(pageId).collection('abTests').doc('current').get()
  if (!snap.exists) return NextResponse.json({ aiDiagnosis: '', winner: 'pending' })
  const data = snap.data()!
  return NextResponse.json({ aiDiagnosis: data.aiDiagnosis ?? '', winner: data.winner ?? 'pending' })
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { pageId, aiDiagnosis, winner, ctrDelta, cpaDelta, controlCopy, variantCopy } = await req.json() as {
    pageId: string; aiDiagnosis?: string; winner?: string
    ctrDelta?: number; cpaDelta?: number; controlCopy?: string; variantCopy?: string
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  if (!(await hasPageAccess(uid, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ref = adminDb.collection('pages').doc(pageId).collection('abTests').doc('current')
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (aiDiagnosis !== undefined) update.aiDiagnosis = aiDiagnosis
  if (winner !== undefined) update.winner = winner
  if (ctrDelta !== undefined) update.ctrDelta = ctrDelta
  if (cpaDelta !== undefined) update.cpaDelta = cpaDelta
  if (controlCopy !== undefined) update.controlCopy = controlCopy
  if (variantCopy !== undefined) update.variantCopy = variantCopy
  await ref.set(update, { merge: true })

  if ((winner === 'A' || winner === 'B') && (controlCopy !== undefined || variantCopy !== undefined)) {
    const historyRef = adminDb.collection('pages').doc(pageId).collection('abTests')
    await historyRef.add({
      winner,
      aiDiagnosis: aiDiagnosis ?? '',
      controlCopy: controlCopy ?? '',
      variantCopy: variantCopy ?? '',
      ctrDelta: ctrDelta ?? null,
      cpaDelta: cpaDelta ?? null,
      completedAt: FieldValue.serverTimestamp(),
    })
  }

  return NextResponse.json({ ok: true })
}
