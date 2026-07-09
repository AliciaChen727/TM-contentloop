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

  // Super-admin manages every page (god-mode), so return all pages regardless of
  // ownOnly. Previously ownOnly skipped this branch and fell through to the
  // super-admin's OWN metaTokens — which made settings/members/links see a
  // DIFFERENT (smaller) page set than the content dashboard. When the content-
  // selected page (e.g. one only visible via god-mode) wasn't in that smaller set,
  // those pages silently fell back to their pages[0] AND overwrote selectedPageId,
  // so the whole app jumped to the wrong club.
  if (isSuperAdmin(uid)) {
    const allPages = await Promise.all((await listAllPages()).map(async p => ({
      ...p,
      threadsConnected: await hasPageThreadsConnection(p.pageId),
    })))
    return NextResponse.json({ pages: allPages, isOwner: true, isAdmin: true })
  }

  // 1) 自己用 OAuth 連接的粉專（metaTokens）— 一律具管理權。
  const snap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const ownPages: PageEntry[] = snap.docs
    .filter(d => d.id !== 'userToken' && d.id !== 'page')
    .map(d => {
      const data = d.data()
      return { pageId: d.id, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null }
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
      memberPages.push({ pageId: vp.pageId, pageName: vp.pageName ?? '', igUserId: vp.igUserId ?? null, permissions, role })
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
