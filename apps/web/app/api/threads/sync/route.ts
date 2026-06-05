/**
 * Threads sync — fetch the connected Threads account's posts + insights into
 * pages/{pageId}/threadsInsights/latest. BFF: Bearer + page access. Uses the
 * page's stored Threads token (graph.threads.net). Content only (no ads).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { GRAPH, getThreadsToken } from '@/lib/threads/client'

const POST_METRICS = 'views,likes,replies,reposts,quotes,shares'
const ACCOUNT_METRICS = 'views,likes,replies,reposts,quotes,followers_count'

async function canAccess(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  return ((viewer.data()?.pages ?? []) as { pageId: string }[]).some(p => p.pageId === pageId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metricMap(data: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of (data?.data ?? [])) {
    const v = m?.total_value?.value ?? m?.values?.[0]?.value ?? 0
    out[m.name] = Number(v) || 0
  }
  return out
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId: string = (await req.json().catch(() => ({}))).pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await canAccess(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Caller's token first; fall back to the page owner's (viewer/super-admin).
  let tok = await getThreadsToken(uid, pageId)
  if (!tok) {
    const owner = await resolvePageOwnerUid(pageId)
    if (owner) tok = await getThreadsToken(owner, pageId)
  }
  if (!tok) return NextResponse.json({ error: 'Threads 未連接，請先到設定連接 Threads', connected: false }, { status: 400 })

  const t = tok.accessToken
  try {
    // 1. Recent posts
    const postsRes = await fetch(`${GRAPH}/v1.0/me/threads?fields=id,media_type,media_url,permalink,text,timestamp&limit=25&access_token=${encodeURIComponent(t)}`)
    const postsData = await postsRes.json()
    if (!postsRes.ok || postsData.error) {
      return NextResponse.json({ error: postsData.error?.message ?? `threads posts ${postsRes.status}` }, { status: 502 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPosts: any[] = postsData.data ?? []

    // 2. Per-post insights (limited to keep it bounded)
    const posts = await Promise.all(rawPosts.slice(0, 25).map(async p => {
      let metrics: Record<string, number> = {}
      try {
        const insRes = await fetch(`${GRAPH}/v1.0/${p.id}/insights?metric=${POST_METRICS}&access_token=${encodeURIComponent(t)}`)
        const ins = await insRes.json()
        if (insRes.ok && !ins.error) metrics = metricMap(ins)
      } catch { /* skip this post's insights */ }
      return {
        id: p.id, mediaType: p.media_type ?? null, text: (p.text ?? '').slice(0, 200),
        permalink: p.permalink ?? null, timestamp: p.timestamp ?? null, metrics,
      }
    }))

    // 3. Account-level insights
    let account: Record<string, number> = {}
    try {
      const accRes = await fetch(`${GRAPH}/v1.0/${tok.threadsUserId}/threads_insights?metric=${ACCOUNT_METRICS}&access_token=${encodeURIComponent(t)}`)
      const acc = await accRes.json()
      if (accRes.ok && !acc.error) account = metricMap(acc)
    } catch { /* account insights optional */ }

    await adminDb.collection('pages').doc(pageId).collection('threadsInsights').doc('latest').set({
      threadsUserId: tok.threadsUserId,
      posts, account,
      postCount: posts.length,
      syncedAt: new Date().toISOString(),
    }, { merge: true })

    return NextResponse.json({ ok: true, postCount: posts.length, account })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'threads sync failed' }, { status: 502 })
  }
}
