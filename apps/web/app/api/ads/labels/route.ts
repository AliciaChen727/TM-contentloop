export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

type Variant = 'A' | 'B' | 'control'

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

  const snap = await adminDb.collection('pages').doc(pageId).collection('creativeLabels').get()
  const labels: Record<string, { variant: Variant; experimentId: string }> = {}
  snap.docs.forEach(d => {
    const data = d.data()
    labels[d.id] = { variant: data.variant as Variant, experimentId: (data.experimentId as string) ?? '' }
  })
  return NextResponse.json({ labels })
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

  const { pageId, adId, variant, experimentId } = await req.json() as { pageId: string; adId: string; variant: Variant | null; experimentId?: string }
  if (!pageId || !adId) return NextResponse.json({ error: 'pageId and adId required' }, { status: 400 })

  if (!(await hasPageAccess(uid, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ref = adminDb.collection('pages').doc(pageId).collection('creativeLabels').doc(adId)
  if (variant === null) {
    await ref.delete()
  } else {
    if (!experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 })
    await ref.set({ variant, experimentId, setBy: uid, setAt: FieldValue.serverTimestamp() })
  }
  return NextResponse.json({ ok: true })
}
