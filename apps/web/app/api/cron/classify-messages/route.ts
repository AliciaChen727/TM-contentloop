export const dynamic = 'force-dynamic'
export const maxDuration = 300 // heavy: fetch + LLM-classify every page × ranges
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { classifyPageMessages, type RangeKey } from '@/lib/messages/classifyPage'

// Background pre-warm of the 「常見問題分類」cache so opening /dashboard/messages
// is instant. Iterates every page token (like /api/cron/sync) and classifies the
// common ranges with force=true. The per-message cache means only genuinely NEW
// inbound messages hit the LLM, so steady-state cost is small.
//
// Work is fanned out with bounded concurrency: the old serial loop (every page ×
// every range, one after another) blew past Vercel's function limit → 504
// FUNCTION_INVOCATION_TIMEOUT. Most of the time is Meta pagination I/O, so running
// a handful of (page,range) tasks in parallel fits comfortably under maxDuration.
const CONCURRENCY = 4
const RANGES: RangeKey[] = ['30d', '90d']

type Task = { uid: string; pageId: string; accessToken: string; igUserId?: string; range: RangeKey }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokenSnaps = await adminDb.collectionGroup('metaTokens').get()
  const tasks: Task[] = []
  for (const doc of tokenSnaps.docs) {
    if (doc.id === 'userToken') continue
    const uid = doc.ref.parent.parent?.id
    if (!uid) continue
    const t = doc.data() as { accessToken?: string; igUserId?: string; pageId?: string }
    const pageId = doc.id === 'page' ? (t.pageId ?? '') : doc.id
    if (!t.accessToken || !pageId) continue
    for (const range of RANGES) {
      tasks.push({ uid, pageId, accessToken: t.accessToken, igUserId: t.igUserId, range })
    }
  }

  const results: Record<string, unknown>[] = []
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++]
      try {
        const r = await classifyPageMessages({
          ownerUid: task.uid,
          pageId: task.pageId,
          accessToken: task.accessToken,
          igUserId: task.igUserId,
          range: task.range,
          force: true,
        })
        results.push({ uid: task.uid, pageId: task.pageId, range: task.range, total: r.totalClassified, newly: r.newlyClassified })
        console.log(`[cron/classify] uid=${task.uid} page=${task.pageId} ${task.range} total=${r.totalClassified} newly=${r.newlyClassified}`)
      } catch (e) {
        console.warn(`[cron/classify] ${task.uid}/${task.pageId}/${task.range}:`, e)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()))

  return NextResponse.json({ ok: true, count: results.length, results })
}
