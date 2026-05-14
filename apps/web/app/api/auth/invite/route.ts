export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { email, pageId } = await req.json()
  if (!email || !pageId) return NextResponse.json({ error: 'Missing email or pageId' }, { status: 400 })

  // Verify inviter is admin of this page
  const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const adminPageIds = new Set(tokensSnap.docs.filter(d => d.id !== 'userToken').map(d => d.id === 'page' ? d.data().pageId : d.id).filter(Boolean))
  if (!adminPageIds.has(pageId)) {
    return NextResponse.json({ error: '你不是此粉絲頁的管理員' }, { status: 403 })
  }

  const pageDoc = tokensSnap.docs.find(d => d.id === pageId) ?? tokensSnap.docs.find(d => d.id === 'page')
  const pageData = pageDoc?.data() ?? {}

  await adminDb
    .collection('invites')
    .doc(email.toLowerCase().trim())
    .collection('pages')
    .doc(pageId)
    .set({
      role: 'viewer',
      invitedBy: uid,
      pageName: pageData.pageName ?? '',
      igUserId: pageData.igUserId ?? null,
      createdAt: new Date(),
      status: 'pending',
    })

  return NextResponse.json({ success: true })
}
