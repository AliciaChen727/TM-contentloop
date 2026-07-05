export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { intentLabel } from '@/lib/messages/intents'
import { classifyPageMessages, type RangeKey } from '@/lib/messages/classifyPage'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const range: RangeKey = body.range === '90d' ? '90d' : body.range === 'all' ? 'all' : '30d'

  // pageId isolation (same as /api/messages).
  let ownerUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    if (!(viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const owner = await resolvePageOwnerUid(pageId)
    if (!owner) return NextResponse.json({ error: 'Page owner not found' }, { status: 404 })
    ownerUid = owner
  }
  const tokenSnap = ownerUid === uid ? ownTokenSnap
    : await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
  const tokenData = tokenSnap.data() as { accessToken?: string; igUserId?: string } | undefined
  if (!tokenData?.accessToken) return NextResponse.json({ error: 'No page access token' }, { status: 400 })

  const r = await classifyPageMessages({
    ownerUid, pageId, accessToken: tokenData.accessToken, igUserId: tokenData.igUserId,
    range, force: body.force === true,
  })

  const en = body.lang === 'en'
  return NextResponse.json({
    topIntents: r.intents.map(i => ({ key: i.key, label: intentLabel(i.key, en), count: i.count, samples: i.samples })),
    cached: r.cached, computedAt: r.computedAt, totalClassified: r.totalClassified,
    newlyClassified: r.newlyClassified, windowDays: r.windowDays,
  })
}
