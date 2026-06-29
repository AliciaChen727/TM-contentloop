export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

// Hard ceiling so the unbounded "全部" query can't read an ever-growing collection in
// one shot. Ranged (7/30/90d) queries are naturally bounded by the date filter.
const READ_CAP = 1000

// Combine two insights maps for the SAME post, taking the best (max) value per
// metric so a real imported number (e.g. reactions 51) beats a live-sync 0.
function mergeInsights(a: unknown, b: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const src of [a, b]) {
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v === 'number') out[k] = Math.max(out[k] ?? 0, v)
      }
    }
  }
  return out
}

// Firestore Timestamp helpers (tolerant of missing/plain values).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tsMillis = (v: unknown): number => (typeof (v as any)?.toMillis === 'function' ? (v as any).toMillis() : 0)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tsIso = (v: unknown): string | null => (typeof (v as any)?.toDate === 'function' ? (v as any).toDate().toISOString() : null)

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

  // Optional date-range filter (YYYY-MM-DD). Absent → "全部" (capped at READ_CAP).
  const since = req.nextUrl.searchParams.get('since')
  const until = req.nextUrl.searchParams.get('until')
  const sinceTs = since ? Timestamp.fromDate(new Date(since + 'T00:00:00.000Z')) : null
  const untilTs = until ? Timestamp.fromDate(new Date(until + 'T23:59:59.999Z')) : null
  const rangedFbQuery = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
    let out = q.orderBy('createdTime', 'desc')
    if (sinceTs) out = out.where('createdTime', '>=', sinceTs)
    if (untilTs) out = out.where('createdTime', '<=', untilTs)
    return out.limit(READ_CAP)
  }

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
      if (!ownerUid) return NextResponse.json({ posts: [], followerStats: [] })
      dataOwnerUid = ownerUid
    }
  }
  const userRef = adminDb.collection('users').doc(dataOwnerUid)

  type RawPost = { id: string; data: Record<string, unknown> }
  let rawPosts: RawPost[]
  if (pageId) {
    const [newSnap, legacySnap] = await Promise.all([
      rangedFbQuery(userRef.collection('pages').doc(pageId).collection('fbPosts')).get(),
      rangedFbQuery(userRef.collection('fbPosts')).get(),
    ])
    // Page-scoped docs (live fb/sync) are the canonical base.
    const byId = new Map<string, Record<string, unknown>>()
    for (const d of newSnap.docs) byId.set(d.id, d.data())
    // Merge in legacy fbPosts (CSV / MD imports). ISOLATION: legacy doc IDs are
    // "{pageId}_{postId}", so the `${pageId}_` prefix filter guarantees we only
    // ever touch THIS page's posts — never another page the admin also manages.
    // Both inputs are thus this-page-only; merging cannot leak cross-page data.
    for (const d of legacySnap.docs) {
      if (!d.id.startsWith(`${pageId}_`)) continue
      const legacy = d.data()
      const base = byId.get(d.id)
      if (!base) { byId.set(d.id, legacy); continue }
      // Keep page-scoped scalars (message/permalink/createdTime), but combine
      // insights field-by-field so imported organic engagement (reactions/saves/
      // shares) is no longer shadowed by a live-sync doc that has 0s.
      byId.set(d.id, { ...legacy, ...base, insights: mergeInsights(base.insights, legacy.insights) })
    }
    rawPosts = Array.from(byId.entries())
      .map(([id, data]) => ({ id, data }))
      .sort((a, b) => tsMillis(b.data.createdTime) - tsMillis(a.data.createdTime))
      .slice(0, READ_CAP)
  } else {
    const snap = await rangedFbQuery(userRef.collection('fbPosts')).get()
    rawPosts = snap.docs.map(d => ({ id: d.id, data: d.data() }))
  }

  const posts = rawPosts
    .map(({ id, data }) => ({
      id,
      ...(data as { message?: string; [key: string]: unknown }),
      createdTime: tsIso(data.createdTime),
      snapshotAt: tsIso(data.snapshotAt),
    }))
    .filter((post) =>
      typeof post.message === 'string' &&
      post.message.trim().length > 0 &&
      !post.message.startsWith('這則貼文沒有文字')
    )

  // Page-level follower time series (only meaningful when scoped to a page)
  let followerStats: { date: string; total: number; net: number }[] = []
  if (pageId) {
    const statsSnap = await userRef.collection('pages').doc(pageId).collection('pageStats').get()
    followerStats = statsSnap.docs
      .map(d => {
        const v = d.data() as { date?: string; total?: number; net?: number }
        return { date: v.date ?? d.id, total: v.total ?? 0, net: v.net ?? 0 }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  return NextResponse.json({ posts, followerStats })
}
