export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, listAllPages } from '@/lib/auth/superadmin'
import { type Role, isRole, legacyPermsForRole } from '@/lib/auth/roles'
import { hasPageThreadsConnection } from '@/lib/threads/client'

interface LegacyPerms { ads: boolean; sidekick: boolean; syncAds: boolean }
interface PageEntry {
  pageId: string
  pageName: string
  igUserId: string | null
  threadsConnected?: boolean
  permissions?: LegacyPerms | null
  role?: Role
  tokenValid?: boolean
  // true only when THIS caller owns the page's token (page is in their own
  // metaTokens) → they can actually re-run OAuth to fix it. Invited admins /
  // super-admins viewing someone else's page get false (reconnect wouldn't help).
  canReconnect?: boolean
}

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
  // tokensOnly: return STRICTLY the caller's own OAuth-connected pages (their own
  // metaTokens) — never god-mode's full list, never invited pages. Used by the
  // Connect/re-authorize page so an admin only ever sees THEIR OWN page there,
  // never other clubs' names (cross-page info leak on the auth screen).
  const tokensOnly = req.nextUrl.searchParams.get('tokensOnly') === 'true'

  // Super-admin manages every page (god-mode), so return all pages regardless of
  // ownOnly. Previously ownOnly skipped this branch and fell through to the
  // super-admin's OWN metaTokens — which made settings/members/links see a
  // DIFFERENT (smaller) page set than the content dashboard. When the content-
  // selected page (e.g. one only visible via god-mode) wasn't in that smaller set,
  // those pages silently fell back to their pages[0] AND overwrote selectedPageId,
  // so the whole app jumped to the wrong club.
  // god-mode is bypassed for tokensOnly so even a super-admin's Connect page shows
  // only the pages they personally FB-authorized (falls through to ownPages below).
  if (isSuperAdmin(uid) && !tokensOnly) {
    // A super-admin sees every page, but can only truly reconnect the ones whose
    // token lives in their OWN metaTokens (i.e. pages they personally FB-manage).
    const ownSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
    const ownIds = new Set(ownSnap.docs.filter(d => d.id !== 'userToken' && d.id !== 'page').map(d => d.id))
    const allPages = await Promise.all((await listAllPages()).map(async p => ({
      ...p,
      threadsConnected: await hasPageThreadsConnection(p.pageId),
      canReconnect: ownIds.has(p.pageId),
    })))
    return NextResponse.json({ pages: allPages, isOwner: true, isAdmin: true })
  }

  // 1) 自己用 OAuth 連接的粉專（metaTokens）— 一律具管理權。
  const snap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const ownPages: PageEntry[] = snap.docs
    .filter(d => d.id !== 'userToken' && d.id !== 'page')
    .map(d => {
      const data = d.data()
      // tokenValid defaults to true unless a sync explicitly flagged it dead, so the
      // owner sees a "reconnect" banner when their stored token has expired/revoked.
      // These pages are in the caller's OWN metaTokens → they can reconnect.
      return { pageId: d.id, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null, tokenValid: data.tokenValid !== false, canReconnect: true }
    })
  // Fallback: 舊 'page' 單一 doc
  if (ownPages.length === 0) {
    const oldDoc = snap.docs.find(d => d.id === 'page')
    if (oldDoc) {
      const data = oldDoc.data()
      ownPages.push({ pageId: data.pageId ?? 'page', pageName: data.pageName ?? '', igUserId: data.igUserId ?? null })
    }
  }
  const ownIds = new Set(ownPages.map(p => p.pageId))

  // tokensOnly → return ONLY the caller's own OAuth-connected pages. No invited
  // pages, no god-mode expansion → the Connect page can never surface another
  // club's name.
  if (tokensOnly) {
    return NextResponse.json({ pages: ownPages, isOwner: false, isAdmin: ownPages.length > 0 })
  }

  // 2) 受邀粉專（users/{uid}/viewerAccess）。新模型帶 role；舊資料只有 permissions → 沿用不擴權。
  let hasInvitedAdmin = false
  const memberPages: PageEntry[] = []
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  if (viewerSnap.exists) {
    const vps: { pageId: string; pageName?: string; igUserId?: string | null; role?: unknown; permissions?: LegacyPerms }[] = viewerSnap.data()?.pages ?? []
    for (const vp of vps) {
      if (ownIds.has(vp.pageId)) continue
      const role: Role | undefined = isRole(vp.role) ? vp.role : undefined
      // 有 role → 由 role 展開 permissions（權威）；無 role（舊 viewer）→ 沿用既存 permissions。
      const permissions = role ? legacyPermsForRole(role) : (vp.permissions ?? null)
      if (role === 'admin' || role === 'owner') hasInvitedAdmin = true
      // Invited to ContentLoop (even as 'admin') ≠ FB admin of the page. Their token
      // isn't in our metaTokens, so reconnect can't help → canReconnect stays false.
      memberPages.push({ pageId: vp.pageId, pageName: vp.pageName ?? '', igUserId: vp.igUserId ?? null, permissions, role, canReconnect: false })
    }
  }

  const combined = [...ownPages, ...memberPages]
  const pagesWithConnections = await Promise.all(combined.map(async p => ({
    ...p,
    threadsConnected: await hasPageThreadsConnection(p.pageId),
  })))

  // 管理權：自己連接的頁 或 被邀為 admin/owner。
  const isAdmin = ownPages.length > 0 || hasInvitedAdmin

  // owner：自己連接的頁中有 admins/{uid}.isOwner。
  let isOwner = false
  for (const page of ownPages) {
    const adminDoc = await adminDb.collection('pages').doc(page.pageId).collection('admins').doc(uid).get()
    if (adminDoc.data()?.isOwner === true) { isOwner = true; break }
  }

  // ownOnly：只回「可管理」的頁（自己連接 + 受邀 admin/owner），供設定/成員/連結頁使用。
  const pages = ownOnly
    ? pagesWithConnections.filter(p => ownIds.has(p.pageId) || p.role === 'admin' || p.role === 'owner')
    : pagesWithConnections

  return NextResponse.json({ pages, isOwner, isAdmin })
}
