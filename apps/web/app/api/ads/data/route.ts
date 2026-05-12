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
    // Prefer user-level data (synced by this user) — always up-to-date
    const ownSnap = await adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
    if (ownSnap.exists) {
      const data = serializeSnap(ownSnap.data()!)
      // If own sync found no creatives, supplement from shared path — another admin
      // (e.g. the one who created the ads) may have synced richer creative data.
      if (!Array.isArray(data.adCreatives) || data.adCreatives.length === 0) {
        const sharedSnap = await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
        if (sharedSnap.exists) {
          const shared = sharedSnap.data()!
          if (Array.isArray(shared.adCreatives) && shared.adCreatives.length > 0) {
            data.adCreatives = shared.adCreatives
            data.adPostIds = shared.adPostIds ?? data.adPostIds
            data.adPostMetrics = shared.adPostMetrics ?? data.adPostMetrics
          }
        }
      }
      return NextResponse.json({ data })
    }

    // Fallback: shared merged insights (populated by other admins or Cloud Functions)
    const memberSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
    if (memberSnap.exists) {
      const sharedSnap = await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
      if (sharedSnap.exists) return NextResponse.json({ data: serializeSnap(sharedSnap.data()!) })
    }

    return NextResponse.json({ data: null })
  }

  // No pageId: legacy user-level path
  const snap = await adminDb.collection('users').doc(uid).collection('adInsights').doc('latest').get()
  if (!snap.exists) return NextResponse.json({ data: null })
  return NextResponse.json({ data: serializeSnap(snap.data()!) })
}
