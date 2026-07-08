/**
 * 角色 × 能力矩陣 — 單一事實來源（純函式，無 I/O、server/client 共用）。
 *
 * 設計見 docs/multi-tenant-rbac.md §2.2。要改權限門檻只動這個檔，
 * access.ts / API routes / UI 都從這裡展開能力，比照診斷引擎 diagnosis.ts 的紀律。
 *
 * 4 角色：Owner ⊃ Admin ⊃ Editor ⊃ Viewer（能力為包含關係）。
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export type Capability =
  // 唯讀分析
  | 'page.view'            // 內容成效首頁 / 看得到這個粉專
  | 'analytics.ads'        // 廣告儀表板
  | 'analytics.links'      // 報名連結追蹤
  | 'analytics.messages'   // 私訊聚合統計（不含原始內容）
  | 'messages.read'        // 原始逐則私訊內容（PII）
  | 'sidekick.use'         // AI Sidekick
  // 編輯 / 同步（草擬層）
  | 'data.sync'            // 觸發手動同步
  | 'content.draft'        // 建立 / 編輯 AI 草稿
  | 'messages.reply'       // 人工回覆單則私訊
  | 'chatbot.manage'       // 設定 / 訓練 / 測試 chatbot（未上線）
  // 對外發佈 / 寫入（審核層，Admin+）
  | 'content.publish'      // 核准並發布貼文草稿
  | 'ads.automate'         // 廣告自動發布（寫入 Meta）
  | 'chatbot.deploy'       // chatbot 上線 / 下線
  // 管理
  | 'members.manage'       // 邀請 / 移除 / 改角色
  | 'page.settings'        // 連接、靜默時段、Kill Switch 等
  | 'page.admin'           // owner-only：刪除頁、移轉 owner

// 角色高低（取最高角色用；group / 未來 org 授權聯集時比較）
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 }

const VIEWER_CAPS: Capability[] = [
  'page.view',
  'analytics.ads',
  'analytics.links',
  'sidekick.use',
]

const EDITOR_CAPS: Capability[] = [
  ...VIEWER_CAPS,
  'analytics.messages',
  'messages.read',
  'data.sync',
  'content.draft',
  'messages.reply',
  'chatbot.manage',
]

const ADMIN_CAPS: Capability[] = [
  ...EDITOR_CAPS,
  'content.publish',
  'ads.automate',
  'chatbot.deploy',
  'members.manage',
  'page.settings',
]

const OWNER_CAPS: Capability[] = [
  ...ADMIN_CAPS,
  'page.admin',
]

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  viewer: VIEWER_CAPS,
  editor: EDITOR_CAPS,
  admin: ADMIN_CAPS,
  owner: OWNER_CAPS,
}

export function capabilitiesForRole(role: Role): Capability[] {
  return ROLE_CAPABILITIES[role]
}

export function roleHasCapability(role: Role, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(cap)
}

/** 取兩角色中較高者（用於直接授權 vs group/org 授權聯集）。 */
export function higherRole(a: Role, b: Role): Role {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer'
}

/**
 * 相容轉換：新角色 → 舊 `{ads, sidekick, syncAds}` permissions 形狀。
 * 過渡期用來餵還在讀 permissions 的消費端（/api/pages、dashboard 側欄 activePerms），
 * 讓 role 成為權威來源、同時不動舊 UI。Phase C 把 UI 改讀 capability 後即可移除。
 */
export function legacyPermsForRole(role: Role): { ads: boolean; sidekick: boolean; syncAds: boolean } {
  return {
    ads: roleHasCapability(role, 'analytics.ads'),
    sidekick: roleHasCapability(role, 'sidekick.use'),
    syncAds: roleHasCapability(role, 'data.sync'),
  }
}
