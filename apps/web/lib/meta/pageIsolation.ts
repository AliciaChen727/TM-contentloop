// Low-level, DUMB page-isolation primitives.
//
// The invariant they encode: a Firestore doc id / Meta story id belongs to a
// page iff it carries that page's `{prefix}_` id prefix (FB doc ids are
// `{pageId}_{postId}`; ad story ids are `{pageId}_{storyId}`; current IG posts
// use the `{igUserId}_` prefix). Callers decide WHICH prefixes count (pageId,
// igUserId, …) — this module never guesses, so unifying call sites can't
// silently drop a branch (e.g. the igUserId one) and open a leak.
//
// Scope of protection (be honest): centralizing the string match gives the
// load-bearing prefix rule ONE tested home and locks it against refactors. It
// does NOT and cannot prevent a call site from forgetting to apply the filter
// at all — every real cross-page incident here was a *missing* filter, not a
// wrong `startsWith`. That class stays the caller's responsibility.
// See .claude/skills/page-isolation-contract and CLAUDE.md.

/** True iff `id` starts with any of `{prefix}_`. Empty/blank prefixes never match. */
export function belongsToAnyPrefix(id: string | undefined | null, prefixes: string[]): boolean {
  if (!id) return false
  return prefixes.some(p => !!p && id.startsWith(`${p}_`))
}

/** Keep only the ids that belong to one of `prefixes`. Drops everything else. */
export function keepIdsForPrefixes(ids: string[], prefixes: string[]): string[] {
  return ids.filter(id => belongsToAnyPrefix(id, prefixes))
}

// ---------------------------------------------------------------------------
// Ad-creative → page matching (extracted from api/ads/sync/route.ts so the hot
// path's isolation logic — including the igUserId branch — has a tested home).
// A creative matches by prefix OR by the page's known FB/IG media ids (the latter
// covers New Page Experience, where an ad's story id may still use an old page id).
// ---------------------------------------------------------------------------

/** The page's known media, used to match ad creatives back to it. */
export interface PageMatchContext {
  pagePrefixes: string[]   // pageId (+ storyIdPrefix for New Page Experience)
  fbMediaIds: Set<string>  // this page's short FB post ids (prefix stripped)
  igUserId?: string
  igMediaIds: Set<string>  // this page's IG media ids
}

/** Strip the leading `{prefix}_` from a story/doc id → the bare post id. */
export function shortStoryId(storyId: string): string {
  return storyId.includes('_') ? storyId.split('_').slice(1).join('_') : storyId
}

/** True iff `storyId` is one of THIS page's FB creatives (by page prefix or known FB post id). */
export function matchesPageStory(storyId: string | undefined, ctx: PageMatchContext): boolean {
  if (typeof storyId !== 'string') return false
  if (belongsToAnyPrefix(storyId, ctx.pagePrefixes)) return true
  const postId = shortStoryId(storyId)
  return ctx.fbMediaIds.has(postId) || ctx.fbMediaIds.has(storyId)
}

/** True iff `storyId` is one of THIS page's IG creatives (by igUserId prefix or known IG media id). */
export function matchesIgStory(storyId: string | undefined, ctx: PageMatchContext): boolean {
  if (typeof storyId !== 'string') return false
  if (ctx.igUserId && belongsToAnyPrefix(storyId, [ctx.igUserId])) return true
  return ctx.igMediaIds.has(shortStoryId(storyId))
}

/** A creative belongs to the page if its FB story id OR its IG story id matches. */
export function creativeBelongsToPage(
  storyId: string | undefined, igStoryId: string | undefined, ctx: PageMatchContext,
): boolean {
  if (!storyId && !igStoryId) return false
  return matchesPageStory(storyId, ctx) || matchesIgStory(storyId, ctx) || (igStoryId ? matchesIgStory(igStoryId, ctx) : false)
}
