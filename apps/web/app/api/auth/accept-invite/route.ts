export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  let email: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
    email = decoded.email ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  if (!email) return NextResponse.json({ hasInvites: false })

  const pendingSnap = await adminDb
    .collection('invites')
    .doc(email.toLowerCase())
    .collection('pages')
    .where('status', '==', 'pending')
    .get()

  if (pendingSnap.empty) return NextResponse.json({ hasInvites: false })

  const batch = adminDb.batch()
  const viewerPages: { pageId: string; pageName: string; igUserId: string | null }[] = []

  for (const inviteDoc of pendingSnap.docs) {
    const data = inviteDoc.data()
    const pageId = inviteDoc.id
    batch.update(inviteDoc.ref, { status: 'accepted', acceptedAt: new Date(), acceptedBy: uid })
    batch.set(
      adminDb.collection('pages').doc(pageId).collection('members').doc(uid),
      { role: 'viewer', email, addedAt: new Date() }
    )
    viewerPages.push({ pageId, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null })
  }

  const viewerAccessRef = adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages')
  const existingSnap = await viewerAccessRef.get()
  const existing: typeof viewerPages = existingSnap.exists ? (existingSnap.data()?.pages ?? []) : []
  const merged = [...existing]
  for (const vp of viewerPages) {
    if (!merged.find(p => p.pageId === vp.pageId)) merged.push(vp)
  }
  batch.set(viewerAccessRef, { pages: merged })

  await batch.commit()

  return NextResponse.json({ hasInvites: true })
}
