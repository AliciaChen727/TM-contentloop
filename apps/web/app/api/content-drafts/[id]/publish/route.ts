/**
 * Publish an APPROVED draft to a platform (Agent 自動發布 S4a Threads + S4b FB/IG).
 * BFF: Bearer + admin-only. Human-in-the-loop: only user-triggered, only after
 * approval. Idempotent: an already-published platform is a no-op. FB/IG need
 * pages_manage_posts / instagram_content_publish (dev-mode admin OK; App Review
 * for general users). See docs/agent-auto-publish-plan.md.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // carousel with videos processes async; parallel but allow headroom

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getDraft, recordPublishOutcome, writeAudit } from '@/lib/content/draftStore'
import { getThreadsToken } from '@/lib/threads/client'
import { publishThreads } from '@/lib/threads/publish'
import { publishToFacebook, publishFbStory } from '@/lib/meta/publishFb'
import { publishToInstagram, publishIgStory } from '@/lib/meta/publishIg'
import type { DraftTarget } from '@/lib/content/draftTypes'

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

// The FB Page access token + linked IG user id live on the owner's metaTokens.
async function getMetaCreds(pageId: string): Promise<{ accessToken?: string; igUserId?: string }> {
  const owner = await resolvePageOwnerUid(pageId)
  if (!owner) return {}
  const d = await adminDb.collection('users').doc(owner).collection('metaTokens').doc(pageId).get()
  const data = d.data() as { accessToken?: string; igUserId?: string } | undefined
  return { accessToken: data?.accessToken, igUserId: data?.igUserId }
}

// Compose the final caption for FB/IG: body + hashtags line.
function composeText(pp?: { body?: string; hashtags?: string[] }): string {
  const body = pp?.body ?? ''
  const tags = (pp?.hashtags ?? []).filter(Boolean)
  return tags.length ? `${body}\n\n${tags.map(h => `#${h}`).join(' ')}` : body
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
  if (draft.status !== 'approved' && draft.status !== 'published') {
    return NextResponse.json({ error: '需先核准草稿才能發布' }, { status: 409 })
  }
  if (draft.publishResults?.[platform]?.postId) {
    return NextResponse.json({ ok: true, alreadyPublished: true, postId: draft.publishResults[platform]!.postId })
  }

  const g = draft.generated
  const media = { mediaType: draft.mediaType, mediaUrl: g.mediaUrl, mediaUrls: g.mediaUrls }
  let result: { ok: true; postId: string; permalink?: string } | { ok: false; error: string }
  let storyId: string | undefined
  let storyNote: string | undefined

  if (platform === 'th') {
    let tok = await getThreadsToken(uid, pageId)
    if (!tok) { const owner = await resolvePageOwnerUid(pageId); if (owner) tok = await getThreadsToken(owner, pageId) }
    if (!tok) return NextResponse.json({ error: 'Threads 未連接或未授權發布，請重新連接 Threads', connected: false }, { status: 400 })
    const r = await publishThreads(tok.accessToken, { text: g.perPlatform.th?.body ?? '', ...media, topicTag: g.threadsTopicTag })
    result = r.ok ? { ok: true, postId: r.rootId, permalink: r.permalink } : r
  } else {
    // FB / IG use the page access token (+ igUserId for IG).
    const creds = await getMetaCreds(pageId)
    if (!creds.accessToken) return NextResponse.json({ error: '找不到粉專存取權杖，請重新連接粉專授權', connected: false }, { status: 400 })
    const text = composeText(g.perPlatform[platform])
    if (platform === 'fb') {
      result = await publishToFacebook(pageId, creds.accessToken, { text, ...media })
    } else {
      if (!creds.igUserId) return NextResponse.json({ error: '此粉專未連動 IG 商業帳號' }, { status: 400 })
      result = await publishToInstagram(creds.igUserId, creds.accessToken, { text, ...media })
    }
    // Also publish a 24h Story (opt-in) — best effort, uses the first media item.
    if (result.ok && g.alsoStory) {
      const storyMedia = g.mediaUrl ?? g.mediaUrls?.[0]
      if (storyMedia) {
        const s = platform === 'fb'
          ? await publishFbStory(pageId, creds.accessToken, storyMedia)
          : await publishIgStory(creds.igUserId!, creds.accessToken, storyMedia)
        if (s.ok) storyId = s.postId
        else storyNote = `限動發布失敗：${s.error}`
      }
    }
  }

  if (!result.ok) {
    await recordPublishOutcome(pageId, params.id, platform, { error: result.error })
    await writeAudit(pageId, params.id, `publish:${platform}:failed`, uid, { error: result.error })
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  const out = await recordPublishOutcome(pageId, params.id, platform, { postId: result.postId, permalink: result.permalink, storyId })
  await writeAudit(pageId, params.id, `publish:${platform}`, uid, { postId: result.postId, storyId })
  return NextResponse.json({ ok: true, postId: result.postId, storyId, storyNote, status: out.ok ? out.draft.status : draft.status })
}
