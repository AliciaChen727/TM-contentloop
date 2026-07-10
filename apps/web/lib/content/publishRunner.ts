// Shared publish runner (Agent 自動發布). One place that actually publishes a
// draft to ONE platform (th/fb/ig) + optional Story, records the outcome, and
// audits — used by both the manual publish route and the scheduled cron so the
// FB/IG/Story logic isn't duplicated. Auth/idempotency stay in the callers.

import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getAnyPageThreadsToken, getThreadsToken } from '@/lib/threads/client'
import { publishThreads } from '@/lib/threads/publish'
import { publishToFacebook, publishFbStory } from '@/lib/meta/publishFb'
import { publishToInstagram, publishIgStory } from '@/lib/meta/publishIg'
import { recordPublishOutcome, writeAudit } from '@/lib/content/draftStore'
import type { ContentDraft, DraftTarget } from '@/lib/content/draftTypes'
import { resolvePublishTagging } from '@/lib/tagging/server'

async function getMetaCreds(pageId: string): Promise<{ accessToken?: string; igUserId?: string }> {
  const owner = await resolvePageOwnerUid(pageId)
  if (!owner) return {}
  const d = await adminDb.collection('users').doc(owner).collection('metaTokens').doc(pageId).get()
  const data = d.data() as { accessToken?: string; igUserId?: string } | undefined
  return { accessToken: data?.accessToken, igUserId: data?.igUserId }
}

export async function hasPageInstagramConnection(pageId: string): Promise<boolean> {
  const creds = await getMetaCreds(pageId)
  return !!creds.igUserId
}

function composeText(pp?: { body?: string; hashtags?: string[] }): string {
  const body = pp?.body ?? ''
  const tags = (pp?.hashtags ?? []).filter(Boolean)
  return tags.length ? `${body}\n\n${tags.map(h => `#${h}`).join(' ')}` : body
}

function appendIgMentions(text: string, usernames?: string[]): string {
  const tags = (usernames ?? []).map(u => u.replace(/^@/, '')).filter(Boolean)
  const missing = tags.filter(u => !new RegExp(`(^|\\s)@${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(text))
  return missing.length ? `${text.trim()}\n\n${missing.map(u => `@${u}`).join(' ')}`.trim() : text
}

export type PublishResult =
  | { ok: true; postId: string; storyId?: string; storyNote?: string }
  | { ok: false; error: string }

// Publish `draft` to one platform (+ Story if opted in). Records the outcome +
// audit. `byUid` is the actor (a uid, or 'cron'). Never throws — returns error.
export async function runPublish(
  pageId: string, draft: ContentDraft, platform: DraftTarget, byUid: string,
): Promise<PublishResult> {
  const g = draft.generated
  const media = { mediaType: draft.mediaType, mediaUrl: g.mediaUrl, mediaUrls: g.mediaUrls }
  try {
    const tagging = await resolvePublishTagging(pageId, draft.tagging)
    let result: { ok: true; postId: string; permalink?: string } | { ok: false; error: string }
    let storyId: string | undefined
    let storyNote: string | undefined

    if (platform === 'th') {
      // For cron publishes (byUid='cron'), try the caller first (no-op for 'cron'),
      // then scan ALL admins of this page to find any valid Threads token.
      // This fixes the case where the connecting user is an admin but not the owner.
      let tok = await getThreadsToken(byUid, pageId)
      if (!tok) tok = await getAnyPageThreadsToken(pageId)
      if (!tok) {
        console.error(`[publishRunner] Threads token not found after scanning all admins: byUid=${byUid} pageId=${pageId} adminCount=${(await adminDb.collection('pages').doc(pageId).collection('admins').get()).size}`)
        return { ok: false, error: 'Threads 未連接或未授權發布' }
      }

      const r = await publishThreads(tok.accessToken, { text: g.perPlatform.th?.body ?? '', ...media, topicTag: g.threadsTopicTag, locationId: tagging.th?.locationId })
      result = r.ok ? { ok: true, postId: r.rootId, permalink: r.permalink } : r
    } else {
      const creds = await getMetaCreds(pageId)
      if (!creds.accessToken) return { ok: false, error: '找不到粉專存取權杖，請重新連接粉專授權' }
      const text = composeText(g.perPlatform[platform])
      if (platform === 'fb') {
        result = await publishToFacebook(pageId, creds.accessToken, {
          text,
          ...media,
          pageMentionIds: tagging.fb?.pageMentionIds,
          personTagIds: tagging.fb?.personTagIds,
          placeId: tagging.fb?.placeId,
        })
      } else {
        if (!creds.igUserId) return { ok: false, error: '此粉專未連動 IG 商業帳號' }
        result = await publishToInstagram(creds.igUserId, creds.accessToken, {
          text: appendIgMentions(text, tagging.ig?.usernames),
          ...media,
          locationId: tagging.ig?.locationId,
        })
      }
      // Story (opt-in) — fully isolated: a Story failure never fails the post.
      if (result.ok && g.alsoStory) {
        const storyMedia = g.mediaUrl ?? g.mediaUrls?.[0]
        if (storyMedia) {
          try {
            const s = platform === 'fb'
              ? await publishFbStory(pageId, creds.accessToken, storyMedia)
              : await publishIgStory(creds.igUserId!, creds.accessToken, storyMedia)
            if (s.ok) storyId = s.postId
            else storyNote = `限動發布失敗：${s.error}`
          } catch (e) { storyNote = `限動發布失敗：${e instanceof Error ? e.message : 'error'}` }
        }
      }
    }

    if (!result.ok) {
      await recordPublishOutcome(pageId, draft.id, platform, { error: result.error })
      await writeAudit(pageId, draft.id, `publish:${platform}:failed`, byUid, { error: result.error })
      return { ok: false, error: result.error }
    }
    // Firestore rejects `undefined` values — only include fields that are defined.
    const outcome: Record<string, unknown> = { postId: result.postId }
    if (result.permalink !== undefined) outcome.permalink = result.permalink
    if (storyId !== undefined) outcome.storyId = storyId
    await recordPublishOutcome(pageId, draft.id, platform, outcome as Parameters<typeof recordPublishOutcome>[3])
    const auditData: Record<string, unknown> = { postId: result.postId }
    if (storyId !== undefined) auditData.storyId = storyId
    await writeAudit(pageId, draft.id, `publish:${platform}`, byUid, auditData)
    return { ok: true, postId: result.postId, storyId, storyNote }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected publish error'
    await recordPublishOutcome(pageId, draft.id, platform, { error: msg }).catch(() => {})
    await writeAudit(pageId, draft.id, `publish:${platform}:error`, byUid, { error: msg }).catch(() => {})
    return { ok: false, error: msg }
  }
}
