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

  // IG followers (best-effort, live): current count + reconstructed ~30d daily trend.
  // `follower_count` insight returns per-day new-follower deltas; we walk back from
  // the current total to derive each day's end-of-day total. Never blocks posts.
  let followersCount: number | null = null
  let followerStats: { date: string; total: number; net: number }[] = []
  if (pageId) {
    try {
      const tokDoc = await userRef.collection('metaTokens').doc(pageId).get()
      const igUserId = tokDoc.data()?.igUserId as string | undefined
      const accessToken = tokDoc.data()?.accessToken as string | undefined
      if (igUserId && accessToken) {
        const GRAPH = 'https://graph.facebook.com/v19.0'
        const curRes = await fetch(`${GRAPH}/${igUserId}?fields=followers_count&access_token=${encodeURIComponent(accessToken)}`)
        const cur = await curRes.json()
        if (curRes.ok && typeof cur.followers_count === 'number') {
          followersCount = cur.followers_count
          const untilS = Math.floor(Date.now() / 1000)
          const sinceS = untilS - 29 * 86400
          const insRes = await fetch(`${GRAPH}/${igUserId}/insights?metric=follower_count&period=day&since=${sinceS}&until=${untilS}&access_token=${encodeURIComponent(accessToken)}`)
          const ins = await insRes.json()
          const vals: { end_time: string; value: number }[] = ins?.data?.[0]?.values ?? []
          const deltas = vals.map(v => ({ date: v.end_time.slice(0, 10), net: Number(v.value) || 0 }))
          const totals = new Array(deltas.length).fill(0)
          if (deltas.length) {
            totals[deltas.length - 1] = followersCount
            for (let i = deltas.length - 1; i > 0; i--) totals[i - 1] = totals[i] - deltas[i].net
          }
          followerStats = deltas.map((d, i) => ({ date: d.date, total: totals[i], net: d.net }))
        }
      }
    } catch { /* followers are best-effort */ }
  }

  return NextResponse.json({ posts, followersCount, followerStats })
}
