export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

function serializeSnap(raw: FirebaseFirestore.DocumentData) {
  return { ...raw, syncedAt: raw.syncedAt?.toDate?.()?.toISOString() ?? null }
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

  if (pageId) {
    // Check if this uid is a verified admin of the page (cross-admin shared data)
    const memberSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()

    if (memberSnap.exists) {
      // Read shared merged insights (contains all admins' ad accounts)
      const sharedSnap = await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
      if (sharedSnap.exists) return NextResponse.json({ data: serializeSnap(sharedSnap.data()!) })
    }

    // Fallback: not yet a member (hasn't re-OAuth'd) or shared doc not yet created → own UID-scoped data
    const ownSnap = await adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
    if (!ownSnap.exists) return NextResponse.json({ data: null })
    return NextResponse.json({ data: serializeSnap(ownSnap.data()!) })
  }

  // No pageId: legacy user-level path
  const snap = await adminDb.collection('users').doc(uid).collection('adInsights').doc('latest').get()
  if (!snap.exists) return NextResponse.json({ data: null })
  return NextResponse.json({ data: serializeSnap(snap.data()!) })
}
