export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { FieldValue } from 'firebase-admin/firestore'

async function resolveAccess(uid: string, pageId: string): Promise<string | null> {
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (ownTokenSnap.exists) return uid
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
  if (viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)) {
    return await resolvePageOwnerUid(pageId)
  }
  return null
}

// GET /api/insights/cache?pageId=xxx&periodKey=2026-05
export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  const periodKey = req.nextUrl.searchParams.get('periodKey') ?? ''
  if (!pageId || !periodKey) return NextResponse.json({ cached: null })

  const ownerUid = await resolveAccess(uid, pageId)
  if (!ownerUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const doc = await adminDb.collection('pages').doc(pageId).collection('insightReports').doc(periodKey).get()
  if (!doc.exists) return NextResponse.json({ cached: null })

  const data = doc.data() ?? {}
  // Normalize Firestore Timestamp → ISO string so the client gets a parseable date.
  const gen = data.generatedAt
  const generatedAt = gen?.toDate ? gen.toDate().toISOString() : (typeof gen === 'string' ? gen : null)

  return NextResponse.json({ cached: { ...data, generatedAt } })
}

// POST /api/insights/cache — save generated report
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const { pageId, periodKey, report, summary, dataFingerprint } = await req.json() as {
    pageId: string; periodKey: string; report: unknown; summary: unknown; dataFingerprint?: string
  }
  if (!pageId || !periodKey || !report) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const ownerUid = await resolveAccess(uid, pageId)
  if (!ownerUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await adminDb.collection('pages').doc(pageId).collection('insightReports').doc(periodKey).set({
    periodKey, report, summary,
    dataFingerprint: dataFingerprint ?? null,
    generatedAt: FieldValue.serverTimestamp(),
    generatedBy: uid,
  })

  return NextResponse.json({ ok: true })
}
