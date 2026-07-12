// Shared publish runner (Agent 自動發布). One place that actually publishes a
// draft to ONE platform (th/fb/ig) + optional Story, records the outcome, and
// audits — used by both the manual publish route and the scheduled cron so the
// FB/IG/Story logic isn't duplicated. Auth/idempotency stay in the callers.

import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getAnyPageThreadsToken, getThreadsToken } from '@/lib/threads/client'
import { publishThreads } from '@/lib/threads/publish'
import { publishToFacebook, publishFbStory } from '@/lib/meta/publishFb'
import { FB_STORY_ENABLED, FB_STORY_DISABLED_NOTE, FB_VIDEO_ENABLED } from '@/lib/content/fbStoryFlag'
import { publishToInstagram, publishIgStory } from '@/lib/meta/publishIg'
import { recordPublishOutcome, writeAudit } from '@/lib/content/draftStore'
import type { ContentDraft, DraftTarget } from '@/lib/content/draftTypes'
import { resolvePublishTagging } from '@/lib/tagging/server'
import { reportBug } from '@/lib/bugs/bugReporter'

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

export type StoryRepairResult =
  | { ok: true; postId: string; storyId: string; storyImageUrl?: string; storyVideoUrl?: string }
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
    const storyAudit: Record<string, unknown> = {}

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
        // Dev mode：API 發的 FB 影片（會被轉 Reel）一般人看不到 → 有封面截圖
        // 就改發圖片貼文；IG/Threads 仍發影片。Live mode（flag 開）恢復發影片。
        const useFbCover = !FB_VIDEO_ENABLED && !!g.fbCoverImageUrl
          && (draft.mediaType === 'video' || draft.mediaType === 'reels')
        result = await publishToFacebook(pageId, creds.accessToken, {
          text,
          ...(useFbCover ? { mediaType: 'image' as const, mediaUrl: g.fbCoverImageUrl } : media),
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
      // FB Story gated off until the Meta app is Live (dev-mode viewers see a
      // black screen); covers scheduled/legacy drafts that pre-date the gate.
      if (result.ok && g.alsoStory && platform === 'fb' && !FB_STORY_ENABLED) {
        storyNote = FB_STORY_DISABLED_NOTE
      } else if (result.ok && g.alsoStory) {
        const storyMedia = g.mediaUrl ?? g.mediaUrls?.[0]
        if (storyMedia) {
          try {
            const s = platform === 'fb'
              ? await publishFbStory(pageId, creds.accessToken, storyMedia)
              : await publishIgStory(creds.igUserId!, creds.accessToken, storyMedia)
            if (s.ok) {
              storyId = s.postId
              if (platform === 'fb' && 'storyImageUrl' in s && s.storyImageUrl) {
                storyAudit.storyImageUrl = s.storyImageUrl
              }
              if (platform === 'fb' && 'storyVideoUrl' in s && s.storyVideoUrl) {
                storyAudit.storyVideoUrl = s.storyVideoUrl
              }
            }
            else storyNote = `限動發布失敗：${s.error}`
          } catch (e) { storyNote = `限動發布失敗：${e instanceof Error ? e.message : 'error'}` }
        }
      }
    }

    if (!result.ok) {
      await recordPublishOutcome(pageId, draft.id, platform, { error: result.error })
      await writeAudit(pageId, draft.id, `publish:${platform}:failed`, byUid, { error: result.error })
      // Slice 18: publish failures are bug reports (per-day deduped) — the
      // operator gets a bell notification without watching audit logs.
      reportBug({
        source: 'publish',
        title: `${platform} 發布失敗`,
        detail: String(result.error ?? 'unknown'),
        context: { pageId, draftId: draft.id, platform },
      }).catch(() => {})
      return { ok: false, error: result.error }
    }
    // Firestore rejects `undefined` values — only include fields that are defined.
    const outcome: Record<string, unknown> = { postId: result.postId }
    if (result.permalink !== undefined) outcome.permalink = result.permalink
    if (storyId !== undefined) outcome.storyId = storyId
    await recordPublishOutcome(pageId, draft.id, platform, outcome as Parameters<typeof recordPublishOutcome>[3])
    const auditData: Record<string, unknown> = { postId: result.postId }
    if (storyId !== undefined) auditData.storyId = storyId
    Object.assign(auditData, storyAudit)
    await writeAudit(pageId, draft.id, `publish:${platform}`, byUid, auditData)
    return { ok: true, postId: result.postId, storyId, storyNote }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected publish error'
    await recordPublishOutcome(pageId, draft.id, platform, { error: msg }).catch(() => {})
    await writeAudit(pageId, draft.id, `publish:${platform}:error`, byUid, { error: msg }).catch(() => {})
    reportBug({
      source: 'publish',
      title: `${platform} 發布例外`,
      detail: msg,
      context: { pageId, draftId: draft.id, platform },
    }).catch(() => {})
    return { ok: false, error: msg }
  }
}

// Repair path for an already-published FB draft whose Story needs to be
// re-created. This intentionally does not call publishToFacebook, so the main
// FB/IG/Threads posts are left untouched.
export async function republishFbStoryOnly(
  pageId: string, draft: ContentDraft, byUid: string,
): Promise<StoryRepairResult> {
  const fbResult = draft.publishResults?.fb
  if (!fbResult?.postId) return { ok: false, error: 'FB 主貼尚未發布，不能只補發限動' }
  const storyMedia = draft.generated.mediaUrl ?? draft.generated.mediaUrls?.[0]
  if (!storyMedia) return { ok: false, error: '此草稿沒有可補發限動的媒體' }

  try {
    const creds = await getMetaCreds(pageId)
    if (!creds.accessToken) return { ok: false, error: '找不到粉專存取權杖，請重新連接粉專授權' }

    const story = await publishFbStory(pageId, creds.accessToken, storyMedia)
    if (!story.ok) {
      await writeAudit(pageId, draft.id, 'publish:fb-story:repair:failed', byUid, { error: story.error, fbPostId: fbResult.postId })
      return { ok: false, error: story.error }
    }

    const outcome: Parameters<typeof recordPublishOutcome>[3] = {
      postId: fbResult.postId,
      storyId: story.postId,
    }
    if (fbResult.permalink) outcome.permalink = fbResult.permalink
    await recordPublishOutcome(pageId, draft.id, 'fb', outcome)

    const auditData: Record<string, unknown> = { fbPostId: fbResult.postId, storyId: story.postId }
    if (story.storyImageUrl) auditData.storyImageUrl = story.storyImageUrl
    if (story.storyVideoUrl) auditData.storyVideoUrl = story.storyVideoUrl
    await writeAudit(pageId, draft.id, 'publish:fb-story:repair', byUid, auditData)

    return { ok: true, postId: fbResult.postId, storyId: story.postId, storyImageUrl: story.storyImageUrl, storyVideoUrl: story.storyVideoUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected story repair error'
    await writeAudit(pageId, draft.id, 'publish:fb-story:repair:error', byUid, { error: msg, fbPostId: fbResult.postId }).catch(() => {})
    return { ok: false, error: msg }
  }
}
