/**
 * Scheduled-publish cron (Agent 自動發布 S5a). Finds due `scheduled` drafts and
 * auto-publishes them to Threads (S5a scope = Threads-only drafts). Respects the
 * per-page Kill Switch and quiet hours. Triggered by GitHub Actions with
 * Authorization: Bearer CRON_SECRET. Fallback/fail-safe: failures mark the draft
 * `failed` (never silent, never loops); FB/IG scheduling waits for S4b.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getThreadsToken } from '@/lib/threads/client'
import { publishThreads } from '@/lib/threads/publish'
import { listByStatus, recordPublishOutcome, transitionDraft, writeAudit } from '@/lib/content/draftStore'
import { getAutomationSettings, inQuietHours } from '@/lib/content/automationStore'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const pageRefs = await adminDb.collection('pages').listDocuments()
  const summary = { pages: 0, published: 0, failed: 0, skipped: 0, deferred: 0 }

  for (const pageRef of pageRefs) {
    const pageId = pageRef.id
    const settings = await getAutomationSettings(pageId)
    if (settings.killSwitch) { summary.skipped++; continue }              // frozen
    if (inQuietHours(settings.quietHours)) { summary.deferred++; continue } // wait

    const scheduled = await listByStatus(pageId, 'scheduled')
    const due = scheduled.filter(d => (d.schedule?.at ?? Infinity) <= now)
    if (due.length === 0) continue
    summary.pages++

    const ownerUid = await resolvePageOwnerUid(pageId)
    const tok = ownerUid ? await getThreadsToken(ownerUid, pageId) : null

    for (const draft of due) {
      // S5a: Threads-only drafts. Multi-platform scheduling waits for S4b.
      if (!(draft.target.length === 1 && draft.target[0] === 'th')) { summary.skipped++; continue }
      if (draft.publishResults?.th?.postId) { summary.skipped++; continue }   // already out
      if (!tok) {
        await recordPublishOutcome(pageId, draft.id, 'th', { error: 'Threads 未連接或未授權發布' })
        await transitionDraft(pageId, draft.id, 'failed', 'cron')
        summary.failed++; continue
      }

      await transitionDraft(pageId, draft.id, 'publishing', 'cron')          // guard against re-pick
      const text = draft.generated.perPlatform.th?.body ?? ''
      const r = await publishThreads(tok.accessToken, { text, mediaUrl: draft.generated.mediaUrl, mediaType: draft.mediaType, topicTag: draft.generated.threadsTopicTag })
      if (r.ok) {
        await recordPublishOutcome(pageId, draft.id, 'th', { postId: r.rootId, permalink: r.permalink })
        await writeAudit(pageId, draft.id, 'publish:th:scheduled', 'cron', { postId: r.rootId })
        summary.published++
      } else {
        await recordPublishOutcome(pageId, draft.id, 'th', { error: r.error })
        await transitionDraft(pageId, draft.id, 'failed', 'cron')
        await writeAudit(pageId, draft.id, 'publish:th:scheduled:failed', 'cron', { error: r.error })
        summary.failed++
      }
    }
  }

  return NextResponse.json({ ok: true, ...summary })
}
