// Meta reports purchases under several action_type names depending on the pixel /
// account setup. Treat them all as "purchase" so revenue / ROAS work regardless of
// the naming variant. Pure (no server deps) — safe on client + server.

export type MetaAction = { action_type: string; value: string }

export const PURCHASE_ACTION_TYPES = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'web_in_store_purchase',
]

export function hasPurchaseAction(actions: MetaAction[]): boolean {
  return actions.some(a => PURCHASE_ACTION_TYPES.includes(a.action_type))
}

// Count (from `actions`) or revenue (from `action_values`). For 'purchase' it scans
// the aliases in priority order — omni 'purchase' already aggregates web/app/offline,
// so pick the FIRST match, never sum → no double counting. Other types: exact match.
export function parseActionValue(actions: MetaAction[], type: string): number {
  if (type === 'purchase') {
    for (const t of PURCHASE_ACTION_TYPES) {
      const hit = actions.find(a => a.action_type === t)
      if (hit) return parseFloat(hit.value ?? '0')
    }
    return 0
  }
  return parseFloat(actions.find(a => a.action_type === type)?.value ?? '0')
}
