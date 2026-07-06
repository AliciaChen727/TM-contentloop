export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

// Read-only Threads insights for the content dashboard. Threads data is stored
// PAGE-scoped (pages/{pageId}/threadsInsights/latest) — no per-owner-uid split —
// so we only need a permission check, then read the snapshot and normalise each
// post to the same shape FB/IG use (reach=views, comments=replies,
// shares=reposts+quotes+shares).
interface RawThreadsPost {
  id: string; mediaType?: string; text?: string; permalink?: string; timestamp?: string
  metrics?: { views?: number; likes?: number; replies?: number; reposts?: number; quotes?: number; shares?: number }
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ posts: [] })

  // Permission: super-admin, page admin (own token or admins record), or viewer.
  let allowed = isSuperAdmin(uid)
    || (await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists
    || (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
  if (!allowed) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    allowed = viewerPages.some(p => p.pageId === pageId)
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('threadsInsights').doc('latest').get()
  if (!snap.exists) return NextResponse.json({ posts: [], connected: false })

  const data = snap.data() ?? {}
  const since = req.nextUrl.searchParams.get('since')
  const until = req.nextUrl.searchParams.get('until')
  const rawPosts: RawThreadsPost[] = data.posts ?? []

  const posts = rawPosts
    .filter(p => {
      if (!p.timestamp) return false
      const d = p.timestamp.slice(0, 10)
      if (since && d < since) return false
      if (until && d > until) return false
      return true
    })
    .map(p => {
      const m = p.metrics ?? {}
      return {
        id: p.id,
        text: p.text ?? '',
        mediaType: p.mediaType ?? 'TEXT',
        permalink: p.permalink ?? '',
        timestamp: p.timestamp ?? '',
        insights: {
          views: m.views ?? 0,
          reach: m.views ?? 0,
          likes: m.likes ?? 0,
          comments: m.replies ?? 0,
          shares: (m.reposts ?? 0) + (m.quotes ?? 0) + (m.shares ?? 0),
        },
      }
    })

  // Follower trend (built from daily snapshots stored by sync — "from today onward").
  const statsSnap = await adminDb.collection('pages').doc(pageId).collection('threadsStats').get()
  const followerStats = statsSnap.docs
    .map(d => ({ date: String(d.data().date ?? d.id), total: Number(d.data().followers ?? 0), net: 0 }))
    .filter(s => s.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < followerStats.length; i++) followerStats[i].net = followerStats[i].total - followerStats[i - 1].total

  return NextResponse.json({
    posts,
    connected: true,
    syncedAt: data.syncedAt ?? null,
    followersCount: typeof data.followersCount === 'number' ? data.followersCount : null,
    followerStats,
  })
}
