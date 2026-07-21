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
