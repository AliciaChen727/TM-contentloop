export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  interface PageEntry { pageId: string; pageName: string; igUserId: string | null; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } | null }
  const snap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const pages: PageEntry[] = snap.docs
    .filter(d => d.id !== 'userToken' && d.id !== 'page')
    .map(d => {
      const data = d.data()
      return { pageId: d.id, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null }
    })

  // Fallback: if no new-style page docs, try old 'page' doc
  if (pages.length === 0) {
    const oldDoc = snap.docs.find(d => d.id === 'page')
    if (oldDoc) {
      const data = oldDoc.data()
      pages.push({ pageId: data.pageId ?? 'page', pageName: data.pageName ?? '', igUserId: data.igUserId ?? null })
    }
  }

  // Also include viewer pages granted via invite
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  if (viewerSnap.exists) {
    const viewerPages: { pageId: string; pageName: string; igUserId: string | null; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } }[] = viewerSnap.data()?.pages ?? []
    for (const vp of viewerPages) {
      if (!pages.find(p => p.pageId === vp.pageId)) {
        pages.push({ pageId: vp.pageId, pageName: vp.pageName, igUserId: vp.igUserId ?? null, permissions: vp.permissions ?? null })
      }
    }
  }

  return NextResponse.json({ pages })
}
