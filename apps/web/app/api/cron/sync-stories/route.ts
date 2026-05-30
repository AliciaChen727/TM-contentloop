export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { syncIgStories } from '@/lib/meta/igStories'
import { syncFbStories } from '@/lib/meta/fbStories'

// Lightweight, story-only sync. Stories vanish from the API 24h after going
// live, so this runs far more often than the daily full sync (FB/IG/ads) to
// capture each story's metrics once they've matured — without bumping the cost
// of the heavier syncs.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const tokenSnaps = await adminDb.collectionGroup('metaTokens').get()
    const results: Record<string, unknown>[] = []

    for (const doc of tokenSnaps.docs) {
      if (doc.id === 'userToken') continue
      const uid = doc.ref.parent.parent?.id
      if (!uid) continue
      const tokenData = doc.data() as { accessToken?: string; igUserId?: string; pageId?: string }
      const pageId = doc.id === 'page' ? (tokenData.pageId ?? '') : doc.id

      if (!tokenData.accessToken || !pageId) continue

      // IG stories need igUserId; FB stories only need the page token.
      const [igResult, fbResult] = await Promise.all([
        tokenData.igUserId
          ? syncIgStories(uid, tokenData.accessToken, tokenData.igUserId, pageId)
          : Promise.resolve({ synced: 0, error: 'no igUserId' }),
        syncFbStories(uid, tokenData.accessToken, pageId),
      ])
      results.push({ uid, pageId, ig: igResult, fb: fbResult })
      console.log(`[cron/sync-stories] uid=${uid} pageId=${pageId} ig=`, igResult, 'fb=', fbResult)
    }

    return NextResponse.json({ synced: results.length, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/sync-stories] FATAL ERROR:', msg, err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
