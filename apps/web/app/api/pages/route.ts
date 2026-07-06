export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, listAllPages } from '@/lib/auth/superadmin'

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

  const ownOnly = req.nextUrl.searchParams.get('ownOnly') === 'true'

  // Super-admin manages every page (god-mode), so return all pages regardless of
  // ownOnly. Previously ownOnly skipped this branch and fell through to the
  // super-admin's OWN metaTokens — which made settings/members/links see a
  // DIFFERENT (smaller) page set than the content dashboard. When the content-
  // selected page (e.g. one only visible via god-mode) wasn't in that smaller set,
  // those pages silently fell back to their pages[0] AND overwrote selectedPageId,
  // so the whole app jumped to the wrong club.
  if (isSuperAdmin(uid)) {
    const allPages = await listAllPages()
    return NextResponse.json({ pages: allPages, isOwner: true, isAdmin: true })
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

  // Admin = has at least one connected-Meta page (before viewer pages appended).
  const isAdmin = pages.length > 0

  // Also include viewer pages granted via invite (skipped when ownOnly=true)
  const viewerSnap = !ownOnly ? await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get() : null
  if (viewerSnap?.exists) {
    const viewerPages: { pageId: string; pageName: string; igUserId: string | null; permissions?: { ads: boolean; sidekick: boolean; syncAds: boolean } }[] = viewerSnap.data()?.pages ?? []
    for (const vp of viewerPages) {
      if (!pages.find(p => p.pageId === vp.pageId)) {
        pages.push({ pageId: vp.pageId, pageName: vp.pageName, igUserId: vp.igUserId ?? null, permissions: vp.permissions ?? null })
      }
    }
  }

  // Check if user is owner of any page
  let isOwner = false
  for (const page of pages) {
    const adminDoc = await adminDb.collection('pages').doc(page.pageId).collection('admins').doc(uid).get()
    if (adminDoc.data()?.isOwner === true) { isOwner = true; break }
  }

  return NextResponse.json({ pages, isOwner, isAdmin })
}
