export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

// Mirror fb/sync's actual /posts query so we can see EXACTLY what Graph
// returns when the engagement field set hits an error (which fb/sync swallows
// behind its 0-engagement fallback). Returns both the "full" and "basic" call
// results side-by-side — never returns the page token itself.

const BASE = 'https://graph.facebook.com/v19.0'
const FULL_FIELDS = 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares'
const BASIC_FIELDS = 'id,message,story,created_time,permalink_url'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  let dataOwnerUid = uid
  const ownSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownSnap.exists) {
    if (!isSuperAdmin(uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const owner = await resolvePageOwnerUid(pageId)
    if (!owner) return NextResponse.json({ error: 'Page owner not found' }, { status: 404 })
    dataOwnerUid = owner
  }

  const tokenSnap = await adminDb.collection('users').doc(dataOwnerUid).collection('metaTokens').doc(pageId).get()
  const { accessToken: pageToken } = (tokenSnap.data() ?? {}) as { accessToken?: string }
  if (!pageToken) return NextResponse.json({ error: 'No stored page token' }, { status: 404 })

  async function probe(fields: string) {
    const url = new URL(`${BASE}/${pageId}/posts`)
    url.searchParams.set('access_token', pageToken!)
    url.searchParams.set('fields', fields)
    url.searchParams.set('limit', '3')
    const res = await fetch(url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null
    try { body = await res.json() } catch { body = await res.text() }
    return {
      status: res.status,
      ok: res.ok,
      error: body?.error ?? null,
      dataCount: Array.isArray(body?.data) ? body.data.length : 0,
      sampleFirst: body?.data?.[0] ?? null,
    }
  }

  const [full, basic] = await Promise.all([probe(FULL_FIELDS), probe(BASIC_FIELDS)])

  return NextResponse.json({
    pageId,
    dataOwnerUid: dataOwnerUid === uid ? '<self>' : dataOwnerUid,
    fullFieldsQuery: FULL_FIELDS,
    basicFieldsQuery: BASIC_FIELDS,
    full,
    basic,
    // What fb/sync would conclude from the same call.
    syncWouldUseFallback: !!(full.error && (full.error.code === 10 || String(full.error.message ?? '').includes('pages_read_engagement'))),
  })
}
