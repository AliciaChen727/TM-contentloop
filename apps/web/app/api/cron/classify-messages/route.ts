export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { classifyPageMessages, type RangeKey } from '@/lib/messages/classifyPage'

// Background pre-warm of the 「常見問題分類」cache so opening /dashboard/messages
// is instant. Iterates every page token (like /api/cron/sync) and classifies the
// common ranges with force=true. The per-message cache means only genuinely NEW
// inbound messages hit the LLM, so steady-state cost is small.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokenSnaps = await adminDb.collectionGroup('metaTokens').get()
  const results: Record<string, unknown>[] = []
  for (const doc of tokenSnaps.docs) {
    if (doc.id === 'userToken') continue
    const uid = doc.ref.parent.parent?.id
    if (!uid) continue
    const t = doc.data() as { accessToken?: string; igUserId?: string; pageId?: string }
    const pageId = doc.id === 'page' ? (t.pageId ?? '') : doc.id
    if (!t.accessToken || !pageId) continue
    for (const range of ['30d', '90d'] as RangeKey[]) {
      try {
        const r = await classifyPageMessages({ ownerUid: uid, pageId, accessToken: t.accessToken, igUserId: t.igUserId, range, force: true })
        results.push({ uid, pageId, range, total: r.totalClassified, newly: r.newlyClassified })
        console.log(`[cron/classify] uid=${uid} page=${pageId} ${range} total=${r.totalClassified} newly=${r.newlyClassified}`)
      } catch (e) {
        console.warn(`[cron/classify] ${uid}/${pageId}/${range}:`, e)
      }
    }
  }
  return NextResponse.json({ ok: true, count: results.length, results })
}
