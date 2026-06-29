export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

// Hard ceiling so the unbounded "全部" query can't read an ever-growing collection at once.
const READ_CAP = 1000

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

  // Resolve data owner: admin queries own data; viewer needs page admin's UID
  let dataOwnerUid = uid
  if (pageId) {
    const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
    if (!ownTokenSnap.exists) {
      const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
      const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
      const allowed = viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const ownerUid = await resolvePageOwnerUid(pageId)
      if (!ownerUid) return NextResponse.json({ posts: [] })
      dataOwnerUid = ownerUid
    }
  }
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  // Optional date-range filter (YYYY-MM-DD). Absent → "全部" (capped at READ_CAP).
  const since = req.nextUrl.searchParams.get('since')
  const until = req.nextUrl.searchParams.get('until')
  const sinceTs = since ? Timestamp.fromDate(new Date(since + 'T00:00:00.000Z')) : null
  const untilTs = until ? Timestamp.fromDate(new Date(until + 'T23:59:59.999Z')) : null
  const rangedIgQuery = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
    let out = q.orderBy('timestamp', 'desc')
    if (sinceTs) out = out.where('timestamp', '>=', sinceTs)
    if (untilTs) out = out.where('timestamp', '<=', untilTs)
    return out.limit(READ_CAP)
  }

  const snap = pageId
    ? await rangedIgQuery(userRef.collection('pages').doc(pageId).collection('igPosts')).get()
    : await rangedIgQuery(userRef.collection('igPosts')).get()

  const posts = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate().toISOString() ?? null,
    snapshotAt: doc.data().snapshotAt?.toDate().toISOString() ?? null,
  }))

  return NextResponse.json({ posts })
}
