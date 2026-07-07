/**
 * Scheduled-publish cron (Agent 自動發布 S5). Finds due `scheduled` drafts and
 * auto-publishes them to ALL target platforms (Threads / FB / IG) via the shared
 * runPublish. Respects the per-page Kill Switch and quiet hours. Triggered by
 * GitHub Actions with Authorization: Bearer CRON_SECRET. Fail-safe: a draft that
 * doesn't fully publish is marked `failed` (never silent, never loops).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { listByStatus, getDraft, transitionDraft } from '@/lib/content/draftStore'
import { runPublish } from '@/lib/content/publishRunner'
import { getAutomationSettings, inQuietHours } from '@/lib/content/automationStore'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const pageRefs = await adminDb.collection('pages').listDocuments()
  const summary = { pages: 0, published: 0, partial: 0, failed: 0, skipped: 0, deferred: 0 }

  for (const pageRef of pageRefs) {
    const pageId = pageRef.id
    const settings = await getAutomationSettings(pageId)
    if (settings.killSwitch) { summary.skipped++; continue }              // frozen
    if (inQuietHours(settings.quietHours)) { summary.deferred++; continue } // wait

    const scheduled = await listByStatus(pageId, 'scheduled')
    const due = scheduled.filter(d => (d.schedule?.at ?? Infinity) <= now)
    if (due.length === 0) continue
    summary.pages++

    for (const draft of due) {
      await transitionDraft(pageId, draft.id, 'publishing', 'cron')   // guard against re-pick
      // Publish every not-yet-published target platform.
      const todo = draft.target.filter(t => !draft.publishResults?.[t]?.postId)
      let anyFail = false
      for (const platform of todo) {
        const r = await runPublish(pageId, draft, platform, 'cron')     // records + audits inside
        if (!r.ok) anyFail = true
      }
      // recordPublishOutcome flips status→published when ALL platforms succeed.
      // If not, move out of `publishing` so it isn't re-picked; mark failed.
      const after = await getDraft(pageId, draft.id)
      if (after?.status === 'published') summary.published++
      else { await transitionDraft(pageId, draft.id, 'failed', 'cron'); if (anyFail) summary.failed++; else summary.partial++ }
    }
  }

  return NextResponse.json({ ok: true, ...summary })
}
