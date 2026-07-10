/**
 * Repair-publish only the Facebook Story for an already-published FB draft.
 * This route never republishes the FB feed post and never touches IG/Threads.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { getUserPageAccess } from '@/lib/auth/access'
import { getDraft } from '@/lib/content/draftStore'
import { republishFbStoryOnly } from '@/lib/content/publishRunner'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId } = (await req.json().catch(() => ({}))) as { pageId?: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  // Owner-only: while the Meta app is in Development mode, API-created FB
  // Stories render black for viewers without an App role — this repair path
  // stays open to the owner for Tester verification and post-Live backfill.
  const access = await getUserPageAccess(uid, pageId)
  if (access?.role !== 'owner') return NextResponse.json({ error: '僅粉專 owner 可補發 FB 限動' }, { status: 403 })

  const draft = await getDraft(pageId, params.id)
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 })
  if (!draft.target.includes('fb')) return NextResponse.json({ error: '此草稿未包含 Facebook' }, { status: 400 })
  if (!draft.publishResults?.fb?.postId) {
    return NextResponse.json({ error: 'FB 主貼尚未發布，不能只補發限動' }, { status: 409 })
  }

  const r = await republishFbStoryOnly(pageId, draft, uid)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({ ok: true, postId: r.postId, storyId: r.storyId })
}
