// Stable identity for a diagnosis card, used to persist Open/Completed/Dismissed
// status across re-syncs. Keyed by recommendation TYPE + its target (post/creative
// id, else the adset/account label) — NOT the metric value, so a card stays
// completed/dismissed even as its numbers update slightly, but a different target
// (e.g. a new best post) yields a new key → reopens. Pure (no node deps) so both
// client and server can import it.

export function diagnosisCardKey(item: { type: string; storyId?: string | null; adset?: string }): string {
  const target = (item.storyId || item.adset || 'account').toString()
  return `${item.type}__${target}`.replace(/\s+/g, '_').slice(0, 180)
}
