export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import {
  exchangeCodeForShortLived,
  exchangeForLongLived,
  getAllManagedPages,
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
    // 3. code → short-lived → long-lived → all managed pages
    const shortLived = await exchangeCodeForShortLived(code)
    const longLived = await exchangeForLongLived(shortLived)
    const pages = await getAllManagedPages(longLived)
    if (!pages.length) throw new Error('No managed pages found. Make sure you are a page admin.')

    const userRef = adminDb.collection('users').doc(uid)

    // 4. 存 user-level token
    await userRef.collection('metaTokens').doc('userToken').set({
      userAccessToken: longLived,
      connectedAt: FieldValue.serverTimestamp(),
    })

    // 5. 存每個 page token
    const batch = adminDb.batch()
    for (const page of pages) {
      const pageRef = userRef.collection('metaTokens').doc(page.pageId)
      batch.set(pageRef, {
        pageId: page.pageId,
        pageName: page.pageName,
        accessToken: page.accessToken,
        igUserId: page.igUserId,
        userAccessToken: longLived,
        connectedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()

    return NextResponse.json({ success: true, pages: pages.map(p => ({ pageId: p.pageId, pageName: p.pageName })) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[meta/route] token exchange error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
