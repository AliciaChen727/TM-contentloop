// Pick the ad account that actually contains a given page's ads, by matching
// effective_object_story_id prefix (`{pagePrefix}_`). Different pages' campaigns
// can live in different ad accounts under the same user, so always using
// accounts[0] silently returns the wrong (or empty) account for some pages.
// Returns the account with the MOST page-matched ads; falls back to accounts[0].

import { belongsToAnyPrefix } from './pageIsolation'

const BASE = 'https://graph.facebook.com/v19.0'
const AD_STATUSES = '["ACTIVE","PAUSED","ARCHIVED","CAMPAIGN_PAUSED","ADSET_PAUSED","WITH_ISSUES","IN_PROCESS"]'

interface AdStoryRef {
  effective_object_story_id?: string
  creative?: { effective_object_story_id?: string; object_story_id?: string }
}

async function countPageAds(acctId: string, pagePrefix: string, token: string): Promise<number> {
  try {
    const u = new URL(`${BASE}/${acctId}/ads`)
    u.searchParams.set('fields', 'effective_object_story_id,creative{effective_object_story_id,object_story_id}')
    u.searchParams.set('effective_status', AD_STATUSES)
    u.searchParams.set('limit', '200')
    u.searchParams.set('access_token', token)
    const r = await (await fetch(u)).json()
    if (!r || r.error) return 0
    return ((r.data ?? []) as AdStoryRef[]).filter(ad => {
      const sid = ad.effective_object_story_id || ad.creative?.effective_object_story_id || ad.creative?.object_story_id || ''
      return belongsToAnyPrefix(sid, [pagePrefix])
    }).length
  } catch {
    return 0
  }
}

export async function selectAdAccountForPage<T extends { id: string }>(
  accounts: T[], pagePrefix: string, userAccessToken: string,
): Promise<T> {
  let best = accounts[0]
  let bestN = -1
  for (const acc of accounts) {
    const n = await countPageAds(acc.id, pagePrefix, userAccessToken)
    if (n > bestN) { bestN = n; best = acc }
  }
  return best
}
