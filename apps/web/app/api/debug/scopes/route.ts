export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

// Inspect the actual scopes granted to the stored page/user access tokens for
// a given pageId — useful when the OAuth scope list requests something (e.g.
// `pages_read_engagement`) but the live API quietly returns nothing, which
// indicates the user/page admin didn't actually grant it.
//
// Returns:
//   - tokenDebug:    Graph debug_token result for the page token (token-level scopes)
//   - userPermissions: /me/permissions called with the user token (grant status per permission)
//   - keyScopeStatus: quick verdict for the permissions we care about
//
// Isolation: caller must own a metaToken for the given pageId, OR be a
// super-admin. Super-admin reads resolve the page's owner uid.

const BASE = 'https://graph.facebook.com/v21.0'
const KEY_SCOPES = [
  'pages_read_engagement',
  'pages_read_user_content',
  'read_insights',
  'ads_read',
  'pages_show_list',
  'pages_manage_metadata',
  'instagram_basic',
  'business_management',
]

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId query param required' }, { status: 400 })

  // Resolve data owner — keep strict isolation (caller-owned, or super-admin).
  let dataOwnerUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    if (!isSuperAdmin(uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const ownerUid = await resolvePageOwnerUid(pageId)
    if (!ownerUid) return NextResponse.json({ error: 'Page owner not found' }, { status: 404 })
    dataOwnerUid = ownerUid
  }

  const tokenSnap = await adminDb.collection('users').doc(dataOwnerUid).collection('metaTokens').doc(pageId).get()
  if (!tokenSnap.exists) return NextResponse.json({ error: 'No stored page token' }, { status: 404 })
  const { accessToken: pageToken, userAccessToken } = (tokenSnap.data() ?? {}) as { accessToken?: string; userAccessToken?: string }
  if (!pageToken) return NextResponse.json({ error: 'Page token missing accessToken field' }, { status: 404 })

  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return NextResponse.json({ error: 'App credentials not configured' }, { status: 500 })
  const appToken = `${appId}|${appSecret}`

  // 1) debug_token on the page token — returns token-level scopes / validity.
  const debugUrl = new URL(`${BASE}/debug_token`)
  debugUrl.searchParams.set('input_token', pageToken)
  debugUrl.searchParams.set('access_token', appToken)

  // 2) /me/permissions with the user token (authoritative for OAuth grants).
  const permsUrl = userAccessToken ? new URL(`${BASE}/me/permissions`) : null
  if (permsUrl && userAccessToken) permsUrl.searchParams.set('access_token', userAccessToken)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [debugRes, permsRes]: [any, any] = await Promise.all([
    fetch(debugUrl).then(r => r.json()).catch(e => ({ error: String(e) })),
    permsUrl ? fetch(permsUrl).then(r => r.json()).catch(e => ({ error: String(e) })) : Promise.resolve(null),
  ])

  const tokenDebug = debugRes?.data ?? debugRes
  const tokenScopes: string[] = Array.isArray(tokenDebug?.scopes) ? tokenDebug.scopes : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permList: { permission: string; status: string }[] = (permsRes?.data ?? []) as any
  const granted = new Set(permList.filter(p => p.status === 'granted').map(p => p.permission))
  const declined = new Set(permList.filter(p => p.status === 'declined').map(p => p.permission))
  // Token scopes are also a signal of what was approved at issuance.
  for (const s of tokenScopes) granted.add(s)

  const keyScopeStatus = Object.fromEntries(
    KEY_SCOPES.map(s => [s, granted.has(s) ? 'granted' : declined.has(s) ? 'declined' : 'missing'])
  )

  return NextResponse.json({
    pageId,
    dataOwnerUid: dataOwnerUid === uid ? '<self>' : dataOwnerUid,
    hasUserAccessToken: !!userAccessToken,
    granted: Array.from(granted).sort(),
    declined: Array.from(declined).sort(),
    keyScopeStatus,
    fbEngagementShouldWork: granted.has('pages_read_engagement'),
    tokenDebug,        // raw debug_token result for the page token
    userPermissions: permsRes,  // raw /me/permissions for the user token
  })
}
