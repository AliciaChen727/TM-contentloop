export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { mapRawAdCreative } from '@/lib/ads/diagnosis'
import { belongsToAnyPrefix } from '@/lib/meta/pageIsolation'
import { selectAdAccountForPage } from '@/lib/meta/selectAdAccount'
import { isReauthRequired, markTokenStatus } from '@/lib/meta/tokenError'

const BASE = 'https://graph.facebook.com/v19.0'

// Read-only historical creative fetch. The dashboard's canonical adInsights/latest
// snapshot is a rolling ~30-day window (overwritten each sync), so Creative Ranking
// can't show creatives that delivered outside it. This route queries Meta directly
// with an explicit time_range for the selected dates, page-filtered, and returns the
// same creative shape buildAdData produces — WITHOUT writing anything (never pollutes
// the canonical snapshot / diagnosis / red-dot). Isolation: page-scoped by the
// {pageId|igUserId}_ story-id prefix (see .claude/skills/page-isolation-contract).
export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId') ?? undefined
  const since = req.nextUrl.searchParams.get('since') ?? undefined
  const until = req.nextUrl.searchParams.get('until') ?? undefined
  if (!pageId || !since || !until) {
    return NextResponse.json({ error: 'pageId, since and until are required' }, { status: 400 })
  }

  // Token resolution mirrors /api/ads/sync: a page admin uses their own token; a
  // super-admin may act on behalf of the page owner (all reads stay page-scoped).
  let dataUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    if (isSuperAdmin(uid)) {
      const ownerUid = await resolvePageOwnerUid(pageId)
      if (!ownerUid) return NextResponse.json({ error: 'No page owner found.' }, { status: 404 })
      dataUid = ownerUid
    } else {
      return NextResponse.json({ error: 'Requires page admin access.' }, { status: 403 })
    }
  }

  const tokenDoc = await adminDb.collection('users').doc(dataUid).collection('metaTokens').doc(pageId).get()
  if (!tokenDoc.exists) return NextResponse.json({ error: 'No Meta token. Please reconnect.' }, { status: 400 })
  const { userAccessToken, storyIdPrefix, igUserId } = tokenDoc.data() as { userAccessToken?: string; storyIdPrefix?: string; igUserId?: string }
  if (!userAccessToken) return NextResponse.json({ error: 'No user access token. Please reconnect Meta.' }, { status: 400 })

  // The prefixes that legitimately belong to THIS page (never guess — caller-supplied,
  // so the igUserId branch can't be silently dropped and open a cross-page leak).
  const pagePrefixes = [storyIdPrefix ?? pageId, igUserId].filter(Boolean) as string[]

  // Discover ad accounts. A dead userAccessToken fails here first → flag it (same
  // field FB/IG paths set) so the dashboard shows a reconnect banner, not a bare 500.
  const acctUrl = new URL(`${BASE}/me/adaccounts`)
  acctUrl.searchParams.set('fields', 'id,name,currency')
  acctUrl.searchParams.set('access_token', userAccessToken)
  const acctRes = await fetch(acctUrl)
  const acctData = await acctRes.json()
  if (!acctRes.ok || acctData.error) {
    if (isReauthRequired(acctData.error)) {
      await markTokenStatus(dataUid, pageId, false, acctData.error?.message)
      return NextResponse.json({ error: acctData.error?.message ?? 'Meta ads token invalid — please reconnect.', tokenInvalid: true }, { status: 401 })
    }
    return NextResponse.json({ error: acctData.error?.message ?? 'Failed to get ad accounts' }, { status: 500 })
  }
  const accounts: { id: string; name: string }[] = acctData.data ?? []
  if (!accounts.length) return NextResponse.json({ creatives: [], dateRange: { since, until }, source: 'meta-historical' })

  // Prefer the account that actually holds this page's ads, but still scan every
  // account and page-filter — a page's campaigns can straddle accounts, and the
  // prefix filter is the real isolation guard regardless of which account we hit.
  const primary = await selectAdAccountForPage(accounts, storyIdPrefix ?? pageId, userAccessToken).catch(() => accounts[0])
  const ordered = [primary, ...accounts.filter(a => a.id !== primary.id)]

  const timeRange = JSON.stringify({ since, until })
  const insFields = `insights.time_range(${timeRange}){spend,impressions,ctr,clicks,reach,actions,action_values}`
  const adFields = `id,name,effective_status,effective_object_story_id,creative{effective_object_story_id,object_story_id,thumbnail_url},campaign{name},${insFields}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMatched: any[] = []
  const MAX_PAGES = 5
  for (const acc of ordered) {
    let next: string | null = (() => {
      const u = new URL(`${BASE}/${acc.id}/ads`)
      u.searchParams.set('fields', adFields)
      u.searchParams.set('effective_status', '["ACTIVE","PAUSED","ARCHIVED","CAMPAIGN_PAUSED","ADSET_PAUSED","WITH_ISSUES","IN_PROCESS"]')
      u.searchParams.set('limit', '100')
      u.searchParams.set('access_token', userAccessToken)
      return u.toString()
    })()
    let page = 0
    while (next && page < MAX_PAGES) {
      const r: Response = await fetch(next)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await r.json()
      if (!r.ok || d.error) break
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const ad of (d.data ?? []) as any[]) {
        const storyId: string = ad.effective_object_story_id || ad.creative?.effective_object_story_id || ad.creative?.object_story_id || ''
        // ISOLATION: only ads whose story id carries this page's prefix.
        if (!belongsToAnyPrefix(storyId, pagePrefixes)) continue
        const ins = ad.insights?.data?.[0]
        if (!ins || parseFloat(ins.spend ?? '0') <= 0) continue // delivered in range only
        rawMatched.push({
          ad_id: ad.id,
          ad_name: ad.name ?? '',
          effective_object_story_id: storyId,
          thumbnail_url: ad.creative?.thumbnail_url ?? null,
          campaign_name: ad.campaign?.name ?? '',
          spend: ins.spend,
          impressions: ins.impressions,
          ctr: ins.ctr,
          actions: ins.actions ?? [],
          action_values: ins.action_values ?? [],
        })
      }
      next = (d.paging?.next as string | undefined) ?? null
      page++
    }
  }

  // De-dupe by ad id (an ad can't appear twice, but guard against account overlap).
  const seen = new Set<string>()
  const creatives = rawMatched
    .filter(c => { if (seen.has(c.ad_id)) return false; seen.add(c.ad_id); return true })
    .map((c, i) => mapRawAdCreative(c, i))

  return NextResponse.json({ creatives, dateRange: { since, until }, source: 'meta-historical' })
}
