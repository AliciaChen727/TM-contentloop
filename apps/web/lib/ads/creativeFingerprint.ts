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
