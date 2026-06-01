export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { writeFeedback } from '@/lib/sidekick/feedbackStore'

async function hasPageAccess(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
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
  if (!snap.exists) return NextResponse.json({ aiDiagnosis: '', winner: 'pending', experimentName: '' })
  const data = snap.data()!
  return NextResponse.json({ aiDiagnosis: data.aiDiagnosis ?? '', winner: data.winner ?? 'pending', experimentName: data.experimentName ?? '' })
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

  const { pageId, aiDiagnosis, winner, ctrDelta, cpaDelta, controlCopy, variantCopy, experimentName } = await req.json() as {
    pageId: string; aiDiagnosis?: string; winner?: string
    ctrDelta?: number; cpaDelta?: number; controlCopy?: string; variantCopy?: string; experimentName?: string
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
  if (experimentName !== undefined) update.experimentName = experimentName
  await ref.set(update, { merge: true })

  if ((winner === 'A' || winner === 'B') && (controlCopy !== undefined || variantCopy !== undefined)) {
    const historyRef = adminDb.collection('pages').doc(pageId).collection('abTests')
    await historyRef.add({
      winner,
      experimentName: experimentName ?? '',
      aiDiagnosis: aiDiagnosis ?? '',
      controlCopy: controlCopy ?? '',
      variantCopy: variantCopy ?? '',
      ctrDelta: ctrDelta ?? null,
      cpaDelta: cpaDelta ?? null,
      completedAt: FieldValue.serverTimestamp(),
    })

    // Feed the proven winner into feedback memory as an adopted example — the
    // highest-quality learning signal (a real, measured win). 'B' = AI-suggested
    // variant won; 'A' = control won. The winning copy becomes adoptedText so it
    // surfaces as a top few-shot example in future diagnosis prompts.
    const winningCopy = winner === 'B' ? (variantCopy ?? '') : (controlCopy ?? '')
    if (winningCopy) {
      const deltaStr = `CTR ${ctrDelta != null ? (ctrDelta > 0 ? `+${ctrDelta}%` : `${ctrDelta}%`) : 'N/A'}、CPA ${cpaDelta != null ? `${cpaDelta > 0 ? '-' : '+'}${Math.abs(cpaDelta)}%` : 'N/A'}`
      await writeFeedback(pageId, {
        source: 'diagnosis', alertType: 'ab_winner',
        context: `A/B 勝出（${winner === 'B' ? 'AI 建議版' : '控制組'}）；當初診斷：${aiDiagnosis ?? 'N/A'}；實際結果：${deltaStr}`,
        output: winningCopy,
        humanAction: 'adopted',
        adoptedText: winningCopy,
        byUid: uid,
      }, experimentName ? `ab__${experimentName}`.replace(/\s+/g, '_').slice(0, 180) : undefined).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
