/**
 * Publish an APPROVED draft to a platform (Agent 自動發布 S4a — Threads only).
 * BFF: Bearer + admin-only. Human-in-the-loop: only user-triggered, only after
 * approval. Idempotent: an already-published platform is a no-op. FB/IG land in
 * S4b (需 App Review). See docs/agent-auto-publish-plan.md.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getDraft, recordPublishOutcome, writeAudit } from '@/lib/content/draftStore'
import { getThreadsToken } from '@/lib/threads/client'
import { publishThreads } from '@/lib/threads/publish'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function canManage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return admin.exists
}

// POST { pageId, platform: 'th' }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, platform } = (await req.json().catch(() => ({}))) as { pageId?: string; platform?: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (platform !== 'th') return NextResponse.json({ error: 'S4a 目前僅支援 Threads 發布（FB/IG 待 App Review）' }, { status: 400 })

  const draft = await getDraft(pageId, params.id)
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
  if (!draft.target.includes('th')) return NextResponse.json({ error: '此草稿未包含 Threads' }, { status: 400 })
  if (draft.status !== 'approved' && draft.status !== 'published') {
    return NextResponse.json({ error: '需先核准草稿才能發布' }, { status: 409 })
  }
  // Idempotent: already on Threads → no-op (never double-post).
  if (draft.publishResults?.th?.postId) {
    return NextResponse.json({ ok: true, alreadyPublished: true, postId: draft.publishResults.th.postId })
  }

  // Token: caller's, else the page owner's (viewer/super-admin path).
  let tok = await getThreadsToken(uid, pageId)
  if (!tok) { const owner = await resolvePageOwnerUid(pageId); if (owner) tok = await getThreadsToken(owner, pageId) }
  if (!tok) return NextResponse.json({ error: 'Threads 未連接或未授權發布，請重新連接 Threads', connected: false }, { status: 400 })

  const text = draft.generated.perPlatform.th?.body ?? ''
  const r = await publishThreads(tok.accessToken, {
    text, mediaUrl: draft.generated.mediaUrl, mediaType: draft.mediaType, topicTag: draft.generated.threadsTopicTag,
  })

  if (!r.ok) {
    // Record the error only (no postId) so the draft stays re-publishable — the
    // user deletes any partial post on Threads and re-publishes from the draft.
    await recordPublishOutcome(pageId, params.id, 'th', { error: r.error })
    await writeAudit(pageId, params.id, 'publish:th:failed', uid, { error: r.error })
    return NextResponse.json({ error: r.error }, { status: 502 })
  }

  const out = await recordPublishOutcome(pageId, params.id, 'th', { postId: r.rootId, permalink: r.permalink })
  await writeAudit(pageId, params.id, 'publish:th', uid, { postId: r.rootId, segments: r.ids.length })
  return NextResponse.json({ ok: true, postId: r.rootId, segments: r.ids.length, status: out.ok ? out.draft.status : draft.status })
}
