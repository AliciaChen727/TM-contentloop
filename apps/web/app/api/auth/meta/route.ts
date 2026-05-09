export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import {
  exchangeCodeForShortLived,
  exchangeForLongLived,
  getPageToken,
} from '@/lib/meta/tokenExchange'
import { FieldValue } from 'firebase-admin/firestore'

export async function POST(req: NextRequest) {
  // 1. 驗證 Firebase ID token
  const authorization = req.headers.get('Authorization')
  const idToken = authorization?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // 2. 取得 OAuth code
  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  try {
    // 3. code → short-lived → long-lived → page token
    const shortLived = await exchangeCodeForShortLived(code)
    const longLived = await exchangeForLongLived(shortLived)
    const pageToken = await getPageToken(longLived)

    // 4. 存入 Firestore
    const tokenRef = adminDb
      .collection('users')
      .doc(uid)
      .collection('metaTokens')
      .doc('page')

    await tokenRef.set({
      pageId: pageToken.pageId,
      pageName: pageToken.pageName,
      accessToken: pageToken.accessToken,
      igUserId: pageToken.igUserId,
      userAccessToken: longLived,
      // Long-lived token 有效期約 60 天
      tokenExpiry: FieldValue.serverTimestamp(),
      connectedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ success: true, pageName: pageToken.pageName })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[meta/route] token exchange error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
