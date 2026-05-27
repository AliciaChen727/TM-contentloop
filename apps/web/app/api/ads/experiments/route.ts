export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { isSuperAdmin } from '@/lib/auth/superadmin'

async function hasPageAccess(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const memberSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (memberSnap.exists) return true
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
  return viewerPages.some(p => p.pageId === pageId)
}

type Experiment = {
  id: string
  name: string
  aiDiagnosis: string
  winner: string
  ctrDelta?: number | null
  cpaDelta?: number | null
}

function mapDoc(id: string, data: FirebaseFirestore.DocumentData): Experiment {
  return {
    id,
    name: data.name ?? '',
    aiDiagnosis: data.aiDiagnosis ?? '',
    winner: data.winner ?? 'pending',
    ctrDelta: data.ctrDelta ?? null,
    cpaDelta: data.cpaDelta ?? null,
  }
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

  const pageRef = adminDb.collection('pages').doc(pageId)
  const expCol = pageRef.collection('experiments')
  const expSnap = await expCol.get()

  // Lazy migration: if no experiments exist yet but legacy labels do, fold the
  // single legacy abTests/current into one experiment and stamp existing labels.
  if (expSnap.empty) {
    const labelsSnap = await pageRef.collection('creativeLabels').get()
    if (!labelsSnap.empty) {
      const legacySnap = await pageRef.collection('abTests').doc('current').get()
      const legacy = legacySnap.exists ? legacySnap.data()! : {}
      const newExpRef = expCol.doc()
      await newExpRef.set({
        name: legacy.experimentName || '實驗 1',
        aiDiagnosis: legacy.aiDiagnosis ?? '',
        winner: legacy.winner ?? 'pending',
        ctrDelta: legacy.ctrDelta ?? null,
        cpaDelta: legacy.cpaDelta ?? null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      const batch = adminDb.batch()
      labelsSnap.docs.forEach(d => {
        if (!d.data().experimentId) {
          batch.set(d.ref, { experimentId: newExpRef.id }, { merge: true })
        }
      })
      await batch.commit()
      return NextResponse.json({ experiments: [mapDoc(newExpRef.id, (await newExpRef.get()).data()!)] })
    }
    return NextResponse.json({ experiments: [] })
  }

  const experiments = expSnap.docs.map(d => mapDoc(d.id, d.data()))
  return NextResponse.json({ experiments })
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

  const body = await req.json() as {
    pageId: string; action?: 'create' | 'delete'; experimentId?: string; name?: string
    aiDiagnosis?: string; winner?: string; ctrDelta?: number; cpaDelta?: number
  }
  const { pageId, action, experimentId } = body
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  if (!(await hasPageAccess(uid, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const expCol = adminDb.collection('pages').doc(pageId).collection('experiments')

  if (action === 'create') {
    const ref = expCol.doc()
    await ref.set({
      name: body.name ?? '',
      aiDiagnosis: '',
      winner: 'pending',
      ctrDelta: null,
      cpaDelta: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return NextResponse.json({ id: ref.id })
  }

  if (action === 'delete') {
    if (!experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 })
    // Clear labels belonging to this experiment, then delete the experiment doc.
    const labelsSnap = await adminDb.collection('pages').doc(pageId).collection('creativeLabels')
      .where('experimentId', '==', experimentId).get()
    const batch = adminDb.batch()
    labelsSnap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(expCol.doc(experimentId))
    await batch.commit()
    return NextResponse.json({ ok: true })
  }

  // Update an existing experiment
  if (!experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 })
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (body.name !== undefined) update.name = body.name
  if (body.aiDiagnosis !== undefined) update.aiDiagnosis = body.aiDiagnosis
  if (body.winner !== undefined) update.winner = body.winner
  if (body.ctrDelta !== undefined) update.ctrDelta = body.ctrDelta
  if (body.cpaDelta !== undefined) update.cpaDelta = body.cpaDelta
  await expCol.doc(experimentId).set(update, { merge: true })
  return NextResponse.json({ ok: true })
}
