export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import {
  exchangeCodeForShortLived,
  exchangeForLongLived,
  getAllManagedPages,
  getPageToken,
  type PageToken,
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

    // User-centric page resolution: always fetch the connecting user's own managed
    // pages first (the D67 owner gets D67+Legacy, Irene gets her own page), then
    // merge in the configured page as a supplement. Previously this was D67-centric
    // (getPageToken first), which surfaced a misleading #100 error to non-D67 admins.
    const pageMap = new Map<string, PageToken>()
    const ownPages = await getAllManagedPages(longLived).catch(() => [])
    for (const p of ownPages) pageMap.set(p.pageId, p)

    if (process.env.META_PAGE_IDENTIFIER) {
      const configured = await getPageToken(longLived).catch(() => null)
      if (configured) pageMap.set(configured.pageId, configured)
    }

    const pages: PageToken[] = Array.from(pageMap.values())
    if (pages.length === 0) {
      throw new Error('找不到你管理的粉絲專頁。請確認授權時有勾選你的粉專，且你是該粉專的管理員（Admin）。')
    }

    const userRef = adminDb.collection('users').doc(uid)

    // 4. 存 user-level token
    await userRef.collection('metaTokens').doc('userToken').set({
      userAccessToken: longLived,
      connectedAt: FieldValue.serverTimestamp(),
    })

    // 5. 存每個 page token（同時保留舊版 'page' doc 供 cron 兼容）
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
    // Keep legacy 'page' doc so existing cron still works before next cron run
    const first = pages[0]
    batch.set(userRef.collection('metaTokens').doc('page'), {
      pageId: first.pageId,
      pageName: first.pageName,
      accessToken: first.accessToken,
      igUserId: first.igUserId,
      userAccessToken: longLived,
      connectedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    // Register this uid as a verified admin for each page (enables cross-admin data sharing)
    // First connector for a page becomes the owner; subsequent OAuth users are non-owners
    const memberBatch = adminDb.batch()
    for (const page of pages) {
      const existingOwnerSnap = await adminDb.collection('pages').doc(page.pageId).collection('admins')
        .where('isOwner', '==', true).limit(1).get()
      const isOwner = existingOwnerSnap.empty
      const adminRef = adminDb.collection('pages').doc(page.pageId).collection('admins').doc(uid)
      memberBatch.set(adminRef, { uid, addedAt: FieldValue.serverTimestamp(), verifiedViaOAuth: true, isOwner }, { merge: true })
    }
    await memberBatch.commit()

    return NextResponse.json({ success: true, pages: pages.map(p => ({ pageId: p.pageId, pageName: p.pageName })) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[meta/route] token exchange error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
