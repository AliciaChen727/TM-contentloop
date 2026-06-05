import { createHash } from 'crypto'

// Account-level "creative set identity": a hash of the sorted (ad_id:story_id)
// pairs. It changes when creatives are swapped / added / removed, so comparing it
// before vs after a recommendation was adopted tells us the user ACTUALLY changed
// their creatives (the "executed" signal), not just clicked 標示完成.
//
// v1 limitation: captures creative-content changes (new creative/post). Pure
// budget- or audience-only edits (same creative) are not yet covered — would need
// adset budget/targeting in the fingerprint (future enhancement).
export function computeCreativeFingerprint(
  creatives: readonly unknown[] | undefined | null,
): string {
  const parts = (creatives ?? [])
    .map(raw => {
      const c = (raw ?? {}) as { ad_id?: unknown; effective_object_story_id?: unknown }
      return `${String(c.ad_id ?? '')}:${String(c.effective_object_story_id ?? '')}`
    })
    .filter(p => p !== ':')
    .sort()
  if (parts.length === 0) return ''
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

// Per-ad content fingerprints keyed by effective_object_story_id → { copy }.
// Used for SPECIFICITY matching: when a card targets a specific creative (its
// storyId is in the cardKey), we can later check whether THAT creative's copy
// changed (= they acted on the recommended ad), not just "some creative changed".
// `copy` = hash of the post message / creative body (post_title is the synced
// message). Absent text → hash of the storyId (still flags a creative swap).
export function computeAdFieldFingerprints(
  creatives: readonly unknown[] | undefined | null,
): Record<string, { copy: string }> {
  const out: Record<string, { copy: string }> = {}
  for (const raw of creatives ?? []) {
    const c = (raw ?? {}) as { effective_object_story_id?: unknown; post_title?: unknown; body?: unknown }
    const sid = String(c.effective_object_story_id ?? '')
    if (!sid) continue
    const copyText = String(c.post_title ?? c.body ?? sid)
    out[sid] = { copy: createHash('sha1').update(copyText).digest('hex').slice(0, 12) }
  }
  return out
}
