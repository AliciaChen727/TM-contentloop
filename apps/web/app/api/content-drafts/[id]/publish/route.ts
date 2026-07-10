/**
 * Publish an APPROVED draft to a platform (Agent 自動發布 S4a Threads + S4b FB/IG).
 * BFF: Bearer + admin-only. Human-in-the-loop: only user-triggered, only after
 * approval. Idempotent: an already-published platform is a no-op. The actual
 * publish logic lives in lib/content/publishRunner (shared with the cron).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // carousel with videos processes async; allow headroom

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { getDraft } from '@/lib/content/draftStore'
import { hasPageInstagramConnection, runPublish } from '@/lib/content/publishRunner'
import { hasPageThreadsConnection } from '@/lib/threads/client'
import type { DraftTarget } from '@/lib/content/draftTypes'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function canManage(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'content.publish')
}

// POST { pageId, platform: 'th' | 'fb' | 'ig' }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, platform } = (await req.json().catch(() => ({}))) as { pageId?: string; platform?: DraftTarget }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (platform !== 'th' && platform !== 'fb' && platform !== 'ig') return NextResponse.json({ error: 'invalid platform' }, { status: 400 })

  const draft = await getDraft(pageId, params.id)
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
  if (!draft.target.includes(platform)) return NextResponse.json({ error: `此草稿未包含 ${platform}` }, { status: 400 })
  if (platform === 'th' && !(await hasPageThreadsConnection(pageId))) {
    return NextResponse.json({ error: '請先建立 Threads 並連結帳號，才能發布 Threads' }, { status: 409 })
  }
  if (platform === 'ig' && !(await hasPageInstagramConnection(pageId))) {
    return NextResponse.json({ error: '請先建立 IG 並連結 Meta 帳號，才能發布 IG' }, { status: 409 })
  }
  // 'failed' is allowed so one platform's failure doesn't block the rest of a
  // multi-platform publish (the per-platform idempotency check below still
  // prevents double-posting anything that already went out). 2026-07-10 實例:
  // FB 假失敗把草稿標成 failed，IG 因此被 409 擋下完全沒發。
  if (draft.status !== 'approved' && draft.status !== 'published' && draft.status !== 'scheduled' && draft.status !== 'failed') {
    return NextResponse.json({ error: '需先核准草稿才能發布' }, { status: 409 })
  }
  // Idempotent: an already-published platform is a no-op (never double-post).
  if (draft.publishResults?.[platform]?.postId) {
    return NextResponse.json({ ok: true, alreadyPublished: true, postId: draft.publishResults[platform]!.postId })
  }

  const r = await runPublish(pageId, draft, platform, uid)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  const after = await getDraft(pageId, params.id)
  return NextResponse.json({ ok: true, postId: r.postId, storyId: r.storyId, storyNote: r.storyNote, status: after?.status ?? draft.status })
}
