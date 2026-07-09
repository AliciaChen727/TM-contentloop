/**
 * 集中式授權層 — 全站唯一的「這個人對這個粉專有什麼權限」入口。
 *
 * 設計見 docs/multi-tenant-rbac.md §2.4。
 *
 * ⚠️ Phase A：本層目前【讀舊 collection】（pages/{pageId}/admins 子集合、
 *    users/{uid}/viewerAccess），把舊模型映射成新角色，行為與現況等價。
 *    Phase B 會把來源統一到 pages/{pageId}/members，並把各 API route 改成
 *    呼叫 requireCapability()。group 授權（§2.3）在 Phase D 才接。
 */

import { NextResponse } from 'next/server'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { isSuperAdmin, listAllPages } from '@/lib/auth/superadmin'
import {
  type Role,
  type Capability,
  capabilitiesForRole,
  roleHasCapability,
  higherRole,
  isRole,
} from '@/lib/auth/roles'

export interface PageAccess {
  pageId: string
  role: Role
  capabilities: Capability[]
  via: 'super' | 'page' | 'group'
}

// 舊 viewer 的細分權限 → 新角色映射（見 docs §5.1）。
// syncAds（可同步）→ editor；其餘（含唯讀 ads/sidekick、或全關）→ viewer。
export interface LegacyPerms { ads?: boolean; sidekick?: boolean; syncAds?: boolean }
export function roleFromLegacyPerms(p: LegacyPerms | undefined | null): Role {
  return p?.syncAds ? 'editor' : 'viewer'
}

function buildAccess(pageId: string, role: Role, via: PageAccess['via']): PageAccess {
  return { pageId, role, capabilities: capabilitiesForRole(role), via }
}

/**
 * 解析某人對某頁的「有效角色 + 能力」。查無 → null（= 無權存取）。
 * 解析順序（取最高權限）：super-admin → 直接 admin → viewer 邀請。
 */
export async function getUserPageAccess(uid: string, pageId: string): Promise<PageAccess | null> {
  // 1) super-admin god-mode（維持現行唯讀跨頁能力，但走同一介面）— 直接最高
  if (isSuperAdmin(uid)) return buildAccess(pageId, 'owner', 'super')

  // 其餘來源全部收集後「取最高角色」，避免同一人多來源時被較低者蓋掉。
  const [adminSnap, metaTokCol, memberSnap, viewerSnap] = await Promise.all([
    // 2) OAuth 直接管理者：pages/{pageId}/admins/{uid}（isOwner flag 區分 owner/admin）
    adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get(),
    // 2b) 自己連接此頁的 token（辨識法對齊 /api/pages：id===pageId，或舊 'page' 單 doc 的 pageId 欄位）
    adminDb.collection('users').doc(uid).collection('metaTokens').get(),
    // 3) 受邀成員（新模型權威來源）：pages/{pageId}/members/{uid}.role
    adminDb.collection('pages').doc(pageId).collection('members').doc(uid).get(),
    // 4) 受邀 viewer 舊索引：users/{uid}/viewerAccess/pages[]（沒有 members role 時的 fallback）
    adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get(),
  ])

  let best: Role | null = null

  if (memberSnap.exists) {
    const md = memberSnap.data()
    const r: Role = isRole(md?.role) ? md!.role : roleFromLegacyPerms(md?.permissions as LegacyPerms)
    return buildAccess(pageId, r, 'page')
  }

  if (adminSnap.exists) {
    best = adminSnap.data()?.isOwner === true ? 'owner' : 'admin'
  } else if (metaTokCol.docs.some(d =>
    (d.id !== 'userToken' && d.id !== 'page' && d.id === pageId) ||
    (d.id === 'page' && d.data()?.pageId === pageId)
  )) {
    // 舊頁在 admins-registration 流程之前連接，沒有 admins 子集合，唯一憑證是連接者的
    // metaTokens。自己連接此頁 = owner 級（對齊 /api/pages 對自連粉專的處理），
    // 避免 can('members.manage') 對這些舊頁 owner 誤判 403。見 memory project_legacy_page_no_admins。
    best = 'owner'
  }

  if (viewerSnap.exists) {
    const pages: { pageId: string; role?: unknown; permissions?: LegacyPerms }[] = viewerSnap.data()?.pages ?? []
    const entry = pages.find(p => p.pageId === pageId)
    if (entry) {
      const r: Role = isRole(entry.role) ? entry.role : roleFromLegacyPerms(entry.permissions)
      best = best ? higherRole(best, r) : r
    }
  }

  // TODO(Phase D): group 授權 — groups/{groupId}/members/{uid} 覆蓋 group 內所有頁，取最高角色。
  return best ? buildAccess(pageId, best, 'page') : null
}

/** 單一能力檢查。無存取權或角色不含該能力 → false。 */
export async function can(uid: string, pageId: string, cap: Capability): Promise<boolean> {
  const access = await getUserPageAccess(uid, pageId)
  return access ? roleHasCapability(access.role, cap) : false
}

export type RequireResult =
  | { ok: true; uid: string; access: PageAccess }
  | { ok: false; res: NextResponse }

/**
 * API route 守門：驗 token → 解析 uid → 檢查能力，否則回 401/403。
 *
 * Phase A 先提供介面；Phase B 才把各資料 route 逐支改成呼叫它，
 * 取代目前每支自己拼裝 viewerAccess + resolvePageOwnerUid + isSuperAdmin。
 */
export async function requireCapability(
  idToken: string | undefined,
  pageId: string,
  cap: Capability,
): Promise<RequireResult> {
  if (!idToken) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
  }
  const access = await getUserPageAccess(uid, pageId)
  if (!access || !roleHasCapability(access.role, cap)) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, uid, access }
}

export interface AccessiblePage {
  pageId: string
  pageName: string
  igUserId: string | null
  role: Role
  via: PageAccess['via']
}

/**
 * 列某人所有可見粉專（直接管理 ∪ 受邀 viewer；super-admin → 全部）。
 *
 * Phase A 沿用現行 /api/pages 的來源（管理頁看 metaTokens）以維持行為等價；
 * Phase B 會把來源統一到 members 並讓 /api/pages 改用本函式。
 */
export async function listAccessiblePages(uid: string): Promise<AccessiblePage[]> {
  if (isSuperAdmin(uid)) {
    const all = await listAllPages()
    return all.map(p => ({ pageId: p.pageId, pageName: p.pageName, igUserId: p.igUserId, role: 'owner' as Role, via: 'super' as const }))
  }

  const map = new Map<string, AccessiblePage>()

  // 管理者自己連接的粉專（mirror /api/pages：metaTokens 且非 userToken/page）
  const tokSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const ownPages = tokSnap.docs.filter(d => d.id !== 'userToken' && d.id !== 'page')
  await Promise.all(ownPages.map(async d => {
    const data = d.data()
    const adminDoc = await adminDb.collection('pages').doc(d.id).collection('admins').doc(uid).get()
    const role: Role = adminDoc.data()?.isOwner === true ? 'owner' : 'admin'
    map.set(d.id, { pageId: d.id, pageName: data.pageName ?? '', igUserId: data.igUserId ?? null, role, via: 'page' })
  }))

  // 受邀 viewer 粉專
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  if (viewerSnap.exists) {
    const pages: { pageId: string; pageName?: string; igUserId?: string | null; permissions?: LegacyPerms }[] = viewerSnap.data()?.pages ?? []
    for (const vp of pages) {
      if (map.has(vp.pageId)) continue
      map.set(vp.pageId, {
        pageId: vp.pageId,
        pageName: vp.pageName ?? '',
        igUserId: vp.igUserId ?? null,
        role: roleFromLegacyPerms(vp.permissions),
        via: 'page',
      })
    }
  }

  return Array.from(map.values())
}
