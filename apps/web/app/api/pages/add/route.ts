export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getPageTokenById } from '@/lib/meta/tokenExchange'
import { FieldValue } from 'firebase-admin/firestore'

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

  const { pageIdentifier } = await req.json()
  if (!pageIdentifier) return NextResponse.json({ error: 'Missing pageIdentifier' }, { status: 400 })

  const userRef = adminDb.collection('users').doc(uid)

  // Get the stored long-lived user token
  const userTokenDoc = await userRef.collection('metaTokens').doc('userToken').get()
  let longLived: string | undefined = userTokenDoc.data()?.userAccessToken
  if (!longLived) {
    // Fallback: read from legacy 'page' doc
    const legacyDoc = await userRef.collection('metaTokens').doc('page').get()
    longLived = legacyDoc.data()?.userAccessToken
  }
  if (!longLived) return NextResponse.json({ error: 'No user access token. Please reconnect Facebook.' }, { status: 400 })

  try {
    const page = await getPageTokenById(longLived, pageIdentifier)

    await userRef.collection('metaTokens').doc(page.pageId).set({
      pageId: page.pageId,
      pageName: page.pageName,
      accessToken: page.accessToken,
      igUserId: page.igUserId,
      userAccessToken: longLived,
      connectedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ success: true, pageId: page.pageId, pageName: page.pageName })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
