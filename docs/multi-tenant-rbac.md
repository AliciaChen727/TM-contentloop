# 多租戶 × 多人員權限管理 — 架構設計文件

> 狀態：📋 設計中（本文件為單一事實來源，實作前需 owner 核准）
> 目標讀者：ContentLoop 開發者
> 建立日期：2026-07-08

---

## 0. 這份文件要解決什麼

ContentLoop 正在從「單一分會的成效儀表板」長成「多粉專 × 多人員 × 有寫入/發布能力」的平台：

- 近期新增：私訊分析、AI 草稿發布、報名連結追蹤
- 未來規劃：廣告自動發布（會對外寫入 Meta）
- 商業方向：擴充更多粉專、可能與 **TM 台灣總會** 合作（總會底下有多個分會粉專）

現有權限模型是「兩層 × 綁死單一粉專」，撐不起上述場景。本文件盤查現況、定義目標模型，並給出**分階段、可回溯相容**的落地計畫。

### 已確認的設計取向（2026-07-08 與 owner 對齊）

| 決策點 | 選擇 |
|---|---|
| 組織模型 | **扁平粉專 + 群組標籤**（不建完整組織階層；用 group 表達「總會→分會」與批次授權）。Organization（租戶）為**未來預留**，見 §2.6 準則 |
| 權限表達 | **具名角色 + 能力矩陣**，收斂為 **4 角色**：Owner / Admin / Editor / Viewer |
| 發布把關 | **分離 編輯者/審核者**：Editor 建草稿、**Admin 才能核准發布**（Approver 併入 Admin） |
| 本次產出 | **完整設計文件，先不動 code** |

---

## 1. 現況盤查（as-is）

### 1.1 身分與授權骨架
- 身分：Firebase Auth（Google / FB 登入），`uid` 為主體。
- 授權：全走 **BFF**（Cloud Function / Next API route → Admin SDK + `verifyIdToken`），**無 `firestore.rules`**。client 不得直讀 Firestore。
- 跨頁隔離鐵則見 `CLAUDE.md`：帶 `pageId` 就一律 page-scoped，viewer/admin/owner 一律適用。

### 1.2 現有角色（只有兩層，且以粉專為單位）

| 角色 | 存放位置 | 產生方式 | 權限 |
|---|---|---|---|
| Owner / Admin | `pages/{pageId}/admins/{uid}`（`isOwner` flag） | OAuth 連接時寫入，**第一個連接者 = owner** | **全開**（隱含擁有所有功能，無細分） |
| Viewer | `pages/{pageId}/members/{uid}` + `users/{uid}/viewerAccess/pages[]`（陣列鏡像） | Email 邀請 → `invites/{email}/pages/{pageId}` → accept | 細分 boolean `{ads, sidekick, syncAds}` |
| Super-admin | env `SUPER_ADMIN_UIDS` | 手動設定 | 跨所有粉專 god-mode（唯讀） |

### 1.3 關鍵檔案
| 職責 | 檔案 |
|---|---|
| 權限原語（super-admin / 解析 owner / 列所有頁） | `lib/auth/superadmin.ts` |
| 判斷 isAdmin/isOwner | `app/api/user/role/route.ts` |
| 成員列表 / 改權限 / 移除 | `app/api/auth/members/route.ts` |
| 邀請 viewer | `app/api/auth/invite/route.ts` |
| 接受邀請 | `app/api/auth/accept-invite/route.ts` |
| OAuth 連接 + 註冊 admin/owner | `app/api/auth/meta/route.ts`（第 90–97 行） |
| 列使用者可見粉專 | `app/api/pages/route.ts` |
| 各資料 API 的 viewer 驗權 | `app/api/ads/*`, `app/api/insights/*`, `app/api/messages/*`（每支各自讀 `viewerAccess` + `resolvePageOwnerUid`） |

### 1.4 六個對「多租戶 + 總會合作」會出問題的缺口

1. **沒有組織/租戶層** — 粉專完全扁平，無法表達「總會→分會」，也無法讓總會管理者一次看到所有分會（跨頁目前只有 env 寫死的 super-admin）。
2. **Admin = 全有全無** — admin 隱含擁有每個功能；新功能（messages/drafts/links/未來 publish）在 UI 全寫死 `show: isAdmin`，沒有細分閘門。
3. **寫入/發布動作無獨立角色** — AI 草稿發布、廣告自動發布會對外發佈，目前任何 admin 都能發，無「編輯 vs 審核」分離。
4. **權限集合寫死** — `{ads, sidekick, syncAds}` 三個 boolean，功能一多就要一直改 schema + 改 UI。
5. **「誰是 admin」有兩個事實來源** — `verifyAdmin`（members route / invite route）看 `metaTokens/{pageId}`；`/api/user/role` 看 `admins` 子集合。兩者可能不一致。
6. **Viewer 權限存三份**（`members` doc、`viewerAccess` array、`invites`），denormalized、易不同步；且**完全沒有操作稽核（audit log）**，開放寫入/自動發布後是實質風險。

---

## 2. 目標模型（to-be）

三個支柱：**統一成員模型** + **具名角色/能力矩陣** + **群組標籤**，外加**集中式授權層**與**稽核**。

### 2.1 統一成員模型（修掉「兩個事實來源」）

所有人（含 owner、admin、viewer）統一存在**一個地方**：

```
pages/{pageId}/members/{uid}
  role: 'owner' | 'admin' | 'approver' | 'editor' | 'analyst' | 'viewer'
  email, displayName
  addedAt, addedBy
  source: 'oauth' | 'invite' | 'group'   # 追溯來源
```

- `admins` 子集合、`viewerAccess` 陣列、`members` 三分裂 → **收斂成單一 `members`**。
- Owner = `role === 'owner'` 的成員。`resolvePageOwnerUid` 改讀 `members` where role==owner（保留 legacy fallback）。
- `metaTokens/{pageId}` **只當 token 儲存**（誰連了、有沒有可用 page token），**不再當授權判斷來源**。授權一律讀 `members`。

> 遷移期：保留 `admins` / `viewerAccess` 為唯讀 fallback 一個 release，backfill 完成、驗證無誤後移除。詳見 §5。

### 2.2 具名角色 × 能力矩陣

**能力（capability）= 授權的原子單位**，角色是能力的集合。UI 與 API 都只檢查 capability，不硬編角色。

能力清單：

| capability | 說明 |
|---|---|
| `page.view` | 看得到這個粉專（內容成效首頁） |
| `analytics.ads` | 廣告儀表板 |
| `analytics.links` | 報名連結追蹤 |
| `analytics.messages` | 私訊**聚合統計**（訊息量、回覆率、FAQ 主題；**不含原始內容**） |
| `messages.read` | 讀**原始逐則私訊內容**（PII，比統計高一級） |
| `sidekick.use` | AI Sidekick |
| `data.sync` | 觸發手動同步（貼文/廣告） |
| `content.draft` | 建立/編輯 AI 草稿 |
| **`content.publish`** | 核准並發布**貼文**草稿（FB/IG/Threads） |
| **`ads.automate`** | **廣告**自動發布（未來寫入 Meta） |
| `messages.reply` | 人工回覆單則私訊 |
| `chatbot.manage` | 設定 / 訓練 / 草擬 chatbot 回覆、測試（未上線） |
| **`chatbot.deploy`** | 把 chatbot **上線 / 下線**到 FB/IG/LINE（無人監督對外互動） |
| `members.manage` | 邀請/移除/改角色 |
| `page.settings` | 連接、靜默時段、Kill Switch 等設定 |
| `page.admin` | owner-only：刪除頁、移轉 owner |

> **「對外發佈 / 寫入」capability 家族**（粗體者）：`content.publish`、`ads.automate`、`chatbot.deploy` 是所有**對外、無人監督**動作的統一家族，一律 **Admin 以上**才能扳開。設計原則：**角色永遠維持 4 個，未來每多一種對外動作就多一個 capability，不新增角色。** 對應的「草擬/設定」能力（`content.draft`、`chatbot.manage`）落在 Editor，形成一致的**編輯者草擬 → 審核者上線**分離。

角色 → 能力矩陣（✓ 有、空白 無）。收斂為 **4 角色**：

| capability | Owner | Admin | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|
| page.view | ✓ | ✓ | ✓ | ✓ |
| analytics.ads | ✓ | ✓ | ✓ | ✓ |
| analytics.links | ✓ | ✓ | ✓ | ✓ |
| sidekick.use | ✓ | ✓ | ✓ | ✓ |
| analytics.messages（私訊統計）| ✓ | ✓ | ✓ | ✗ |
| messages.read（原始私訊）| ✓ | ✓ | ✓ | ✗ |
| data.sync | ✓ | ✓ | ✓ | |
| content.draft | ✓ | ✓ | ✓ | |
| messages.reply（人工回覆）| ✓ | ✓ | ✓ | |
| chatbot.manage（設定/訓練/測試）| ✓ | ✓ | ✓ | |
| **content.publish（貼文發布）** | ✓ | ✓ | | |
| **ads.automate（廣告自動）** | ✓ | ✓ | | |
| **chatbot.deploy（bot 上線）** | ✓ | ✓ | | |
| members.manage | ✓ | ✓ | | |
| page.settings | ✓ | ✓ | | |
| page.admin | ✓ | | | |

> **私訊比廣告/貼文數據敏感一級** → `analytics.messages` 與 `messages.read` 皆 **Editor 以上**，**Viewer 完全不碰私訊**（總會 Viewer 看得到廣告/貼文/連結成效，但看不到任何分會私訊）。

角色語意速記：
- **Owner** — 連接者，除全部能力外唯一能刪頁/移轉 owner。
- **Admin** — 除 owner-only 外全能，含管理成員、改設定、**核准發布**、自動發布。**同時是審稿者**（Approver 已併入 Admin）。
- **Editor** — 能建草稿、同步、看所有分析，但**不能發布**（草稿推到「待核准」後等 Admin 核准）。
- **Viewer** — **唯讀廣告/貼文/連結分析 + Sidekick**，**不含私訊**（統計與內容皆不給），不能同步、不能碰內容、不能管理。≈ 原設計的 Analyst 但去除私訊。

> **編輯/審核分離**由 Editor（建稿）與 Admin（核准發布）承接，不再需要獨立 Approver 角色。
> **「只看貼文」那層取消** — 若日後真的需要更細（例如只給看貼文、不給看廣告），再用 §9 的「per-member capability 覆蓋」補，不預先做。
> 現有 viewer 的 `{ads, sidekick, syncAds}` 組合，遷移時對應：有 `syncAds` → **Editor**；其餘（含全關）→ **Viewer**。詳見 §5 對照表。

矩陣本身集中在一個檔：`lib/auth/roles.ts`（`ROLE_CAPABILITIES: Record<Role, Set<Capability>>`）。改權限只動這一檔（比照診斷引擎 `diagnosis.ts` 的單一事實來源紀律）。

### 2.3 群組標籤（表達「總會→分會」+ 批次授權）

不建組織實體，改用**輕量 group**：一個 group 是一組粉專的標籤 + 一份成員授權。

```
groups/{groupId}
  name: 'TM 台灣總會'
  createdBy, createdAt

groups/{groupId}/pages/{pageId}     # 這個 group 涵蓋哪些粉專（反查用）
  addedAt, addedBy

groups/{groupId}/members/{uid}      # group 層級授權
  role: 'admin' | 'editor' | 'viewer'   # 一次套用到 group 內所有頁（沿用同一組 4 角色）
  addedAt, addedBy
```

- 粉專仍是扁平主鍵；group 只是「標籤 + 批次授權」的疊加層。
- 一頁可屬於多個 group；`pages/{pageId}` 加 `groupIds: string[]` 做正查冗餘（可選，加速 `/api/pages`）。
- **總會視角** = 給總會窗口一個 `groups/tm-taiwan/members/{uid}` role=`viewer`（唯讀所有分析），他就能看到旗下所有分會，**不必逐頁邀請**。
- group 授權與 page 直接授權**取聯集、取最高角色**（見 §2.4）。

> ⚠️ **不要跟「粉專分類資料夾」搞混**（2026-08-09 已實作）：`lib/pages/pageFolders.ts` +
> `users/{uid}/settings/pageFolders` 是**純顯示**的選單分類（把 5 個 TM 分會跟個人品牌粉專分開列），
> **完全不影響權限**，也不是 Stage D 的部分實作。命名刻意用 folder 而非 group，就是為了避免這個誤會。
> 本節的 `groups/{groupId}` 仍**尚未實作**，`lib/auth/access.ts` 的 `TODO(Phase D)` 還在。

### 2.6 Organization vs Group — 判斷準則與未來疊加方式

> 決策（2026-07-08）：**現在用 Group，Organization 為未來預留**。兩者不衝突、可共存。

| | **Group（本設計採用）** | **Organization（租戶，未來）** |
|---|---|---|
| 本質 | 一組粉專的**標籤 + 批次授權** | **擁有**粉專的一級容器 |
| 一頁能屬於幾個 | **多個**（可重疊，像 hashtag） | **恰好一個**（硬邊界，互斥） |
| 誰來管理 | 平台方 / super-admin 指派 | **org 自己的 admin 自助管理**團隊與成員 |
| 計費 / 方案 | 無此概念 | 計費、方案、席次掛在 org |
| 資料隔離 | 不改變隔離（仍 per-page） | 乾淨的**租戶邊界**（競品之間互不可見） |
| 適用 | 「一次授權多頁」「總會看旗下分會」 | 「賣給獨立商家，各自帳單、各自管團隊、彼此隔離」 |

**已登記的需求（2026-08-09，owner 提出）**：owner 同時管理 5 個 TM 分會粉專，希望
「**邀請台灣總會進來，以總會視角比較各分會表現**」。這正是 §2.3 Group 的設計用途
（group 層 viewer → 一次看旗下所有分會，不必逐頁邀請）。

- **現況可用替代**：`/dashboard/compare`（跨粉專總覽，Phase 3B Slice 17 已上線）已能並排比較
  廣告成效／素材趨勢／受眾／自然貼文，但**僅限 caller 自己 admin 的粉專**
  （`app/api/pages/compare/route.ts:78` 過濾 `access === 'admin'`）→ 目前只有 owner／super-admin 看得到。
- **缺口**：要讓「總會窗口」這種外部角色看到同一份比較，就必須做 Stage D 的 group 授權；
  現行只能逐頁邀請 5 次，且無法用單一 group 收攏。
- **優先級**：等實際要邀請總會時再做，非現在。

**何時該引入 Organization** — 以下訊號**至少出現一個**：
1. 合作商家要**自己登入後台、自助管理自己的員工**（不再由平台方代管）。
2. 需要**分別計費 / 方案 / 席次**。
3. 合作方彼此是**競品，需硬性租戶隔離**（超出現行 per-page 隔離）。

在此之前，現行 `owner uid` 已是 de-facto 租戶邊界，Group 足以覆蓋總會與初期商家合作。

**未來疊加方式（Group 投資完全保留）**：
- 新增 `organizations/{orgId}`（name, plan, billing, createdBy）。
- 每頁 `pages/{pageId}` 加 `orgId`（**恰好一個**，計費/所有權邊界）；**同時仍可被貼多個 `groupIds`**（存取便利）。
- 遷移：每個現有 owner uid → 自動建立一個 org，其名下粉專掛入。
- `access.ts` 增加一層 org-role 解析（org-admin 對 org 內所有頁有 admin 能力），與 page/group 解析**取聯集、取最高角色**。

### 2.7 計費 / 方案（Entitlement）— 與 RBAC、Group 正交的第三軸

> 決策方向（2026-07-08）：freemium（部分功能免費試用、進階功能付費解鎖）。**計費不需要 Organization，現行 Group 架構完全支撐。**

三個軸互不取代：

| 軸 | 問題 | 由什麼決定 |
|---|---|---|
| RBAC（角色/能力） | 這個**人**被**允許**做嗎？ | role → capability |
| Grouping（群組） | 這份授權**涵蓋哪些頁**？ | group |
| **Entitlement（方案）** | 這個功能**付費解鎖了嗎**？ | plan → entitlement |

**功能可用性 = `can(capability)` AND `isEntitled(feature)`** — 兩個獨立閘門都要過。角色說「你有權按」，方案說「這功能在你的方案有開」。

- Admin（角色可發廣告）+ Free（`ads.automate` 未解鎖）→ 顯示「升級解鎖」。
- Editor + Pro（已解鎖）→ 但 Editor 角色不含 `content.publish` → 仍不能發。

**收費主體（billing subject）**：freemium 初期二選一，**皆不需 org**：
- **掛粉專**（建議）：`pages/{pageId}.plan`。每分會各自試用/解鎖，最好變現。
- **掛帳號**：`users/{ownerUid}.plan`。一人付費涵蓋名下所有粉專。

資料模型（以掛粉專為例）：
```
pages/{pageId}
  plan: 'free' | 'pro' | 'business'
  trialEndsAt, planExpiresAt
  entitlements: { 'ads.automate': true, 'chatbot.deploy': false, ... }  # 由 plan 展開，可個別覆蓋
```

方案 → 功能對照集中在單一檔 `lib/billing/entitlements.ts`（`PLAN_ENTITLEMENTS: Record<Plan, Set<Feature>>`），比照 `roles.ts` 的單一事實來源紀律。

組合閘門 helper：
```ts
// lib/billing/entitlements.ts
isEntitled(pageId, feature): Promise<boolean>
// 供 route / UI 用的總閘門（能力 AND 方案）
canUse(uid, pageId, feature): Promise<boolean>  // = can(uid,pageId,cap) && isEntitled(pageId,feature)
```

**與 Organization 的關係**：計費**不是**引入 org 的理由（§2.6 的觸發訊號是「自助管團隊 + 席次制」）。未來若真的走 org，org 只是把旗下粉專方案**聚合成一張帳單**的容器，per-page 方案資料完全保留、遷移平順。

免費/付費初步切分（草案，實際定價另議）：

| 功能 | Free | Pro |
|---|:-:|:-:|
| 貼文/廣告/連結成效唯讀 | ✓ | ✓ |
| 診斷引擎 + 紅點通知 | ✓ | ✓ |
| AI Sidekick | 限量 | 不限 |
| AI 草稿 + 發布 | | ✓ |
| 廣告自動發布 | | ✓ |
| 私訊分析 + Chatbot | | ✓ |
| 多粉專 / Group | 1 頁 | 多頁 |
| 歷史資料範圍 | 近 N 天 | 完整 |

### 2.4 集中式授權層（修掉「每支 route 各自 reimplments」）

新增 `lib/auth/access.ts`，全站唯一授權入口：

```ts
// 解析某人對某頁的「有效角色」= max(super-admin, 直接 member, 各 group 授權)
getUserPageAccess(uid, pageId): Promise<{ role, capabilities: Set<Capability>, via: 'super'|'page'|'group' } | null>

// 單一能力檢查
can(uid, pageId, cap): Promise<boolean>

// route 用的守門：驗 token → 解析 uid → 檢查 capability，否則回 403
requireCapability(idToken, pageId, cap): Promise<{ uid } | NextResponse /* 401/403 */>

// 列某人所有可見頁（直接 member ∪ 各 group 覆蓋的頁 ∪ super-admin→全部）
listAccessiblePages(uid): Promise<PageAccess[]>
```

有效角色解析順序（取最高）：
1. `isSuperAdmin(uid)` → 等同 owner-level（維持現有 god-mode，但走同一介面）。
2. 直接成員 `pages/{pageId}/members/{uid}.role`。
3. 群組授權：對使用者有角色的每個 group，若 `pageId ∈ group` → 該 group role。
4. 皆無 → `null`（403）。

**所有資料 API（ads / insights / messages / links / drafts …）改為第一行呼叫 `requireCapability(...)`**，刪掉各自的 `viewerAccess` + `resolvePageOwnerUid` + `isSuperAdmin` 拼裝。跨頁隔離仍由「以回傳的 pageId 為界、資料路徑 page-scoped」保證，不變。

### 2.5 稽核（audit log）

開放寫入/發布前必備。

```
pages/{pageId}/auditLog/{autoId}
  actor: uid
  action: 'member.add' | 'member.remove' | 'member.role_change'
        | 'draft.publish' | 'draft.schedule' | 'ads.automate'
        | 'page.settings_change' | 'group.grant' | ...
  target: { uid?, draftId?, ... }
  meta: { ... }
  at: serverTimestamp
```

至少記錄：成員異動、草稿發布/排程、廣告自動發布、設定變更、群組授權。給 owner 與總會信任基礎。

---

## 3. 對現有功能頁的影響（capability 對照）

UI 側把寫死的 `show: isAdmin` 改成 `show: can('<cap>')`（client 拿 `/api/user/role` 回傳的 capability 集合判斷；真正把關仍在 API）。

| 功能頁 | 現在 | 改為 capability |
|---|---|---|
| 內容成效首頁 | isAdmin/viewer | `page.view` |
| 廣告儀表板 | `isAdmin \|\| perms.ads` | `analytics.ads` |
| 報名連結追蹤 | `isAdmin` | `analytics.links` |
| 私訊分析（統計） | `isAdmin` | `analytics.messages`（Editor+，Viewer 不給） |
| 私訊原始內容 | `isAdmin` | `messages.read`（Editor+） |
| AI 草稿發布（建） | `isAdmin` | `content.draft` |
| AI 草稿發布（核准/發布） | `isAdmin` | `content.publish`（Admin+） |
| 廣告自動發布（未來） | — | `ads.automate`（Admin+） |
| 私訊人工回覆（未來） | — | `messages.reply`（Editor+） |
| Chatbot 設定/訓練（未來 Phase 5） | — | `chatbot.manage`（Editor+） |
| Chatbot 上線 FB/IG/LINE（未來 Phase 5） | — | `chatbot.deploy`（Admin+） |
| AI Sidekick | `isAdmin \|\| perms.sidekick` | `sidekick.use` |
| 手動同步 | `isAdmin` | `data.sync` |
| 成員管理 | `isAdmin` | `members.manage` |

**發布把關（Editor/Approver 分離）落地**：草稿狀態機沿用 `auto-publish-agent` skill 的 `草稿 → 待核准 → 驗證 → 發布/排程`。差別是：
- `content.draft`（Editor+）能建立草稿、把草稿推進到「待核准」。
- 只有 `content.publish`（Approver/Admin/Owner）能執行「核准 → 發布/排程」與觸發 `ads.automate`。
- 發布/排程動作寫 audit log。

---

## 4. `/api/user/role` 的演進（回溯相容）

現在回 `{ isOwner, isAdmin }`。改為額外回 `role` 與 `capabilities`，同時**保留** `isOwner`/`isAdmin` 由 role 推導（`isAdmin = role ∈ {owner,admin}`、`isOwner = role==='owner'`），前端不需一次全改：

```jsonc
{
  "role": "editor",
  "capabilities": ["page.view", "analytics.ads", "content.draft", "data.sync", ...],
  "isOwner": false,   // 由 role 推導，維持舊 UI 相容
  "isAdmin": false
}
```

---

## 5. 資料遷移計畫（v0 → v1）

**原則**：backfill 為主、雙寫過渡、舊集合保留一個 release 當 fallback、驗證後移除。全程不影響現有登入/讀取。

### 5.1 Backfill 腳本（一次性，冪等）
對每個 `pages/{pageId}`：
1. 讀 `admins/{uid}` → 寫 `members/{uid}` role = `isOwner ? 'owner' : 'admin'`，`source:'oauth'`。
2. 讀舊 `members/{uid}`（現存 viewer）+ 其 `permissions` → 依下表映射 role，`source:'invite'`：

   | 舊 permissions | 新 role |
   |---|---|
   | `syncAds: true`（可同步）| `editor` |
   | 其餘（含 `ads`/`sidekick` 唯讀、或全 false）| `viewer`（Viewer 現已含唯讀所有分析 + Sidekick） |

3. `pendingInvites` / `invites/{email}/pages/{pageId}` 的 `permissions` → 加 `role` 欄位（邀請時就選角色，見 §6）。

### 5.2 讀取端過渡
- `resolvePageOwnerUid`：先讀 `members` where role==owner；查無 → 現有 `admins` fallback → legacy `metaTokens` fallback（維持 §1 現行三層）。
- `access.ts` 的 `getUserPageAccess`：先讀 `members`；查無 → 讀 `admins`/`viewerAccess` fallback（過渡期）。

### 5.3 清理（下一個 release）
- backfill 驗證 + 兩粉專交叉測試通過後，移除 `admins` / `viewerAccess` 讀取路徑與寫入。
- `verifyAdmin`（members/invite route 內）刪除，改用 `requireCapability(..., 'members.manage')`。

---

## 6. 邀請流程調整

邀請時**選角色**（取代現在勾 `{ads,sidekick,syncAds}`）：

- `invites/{email}/pages/{pageId}` 存 `{ role, invitedBy, ... }`。
- accept 時寫 `pages/{pageId}/members/{uid}` role，`source:'invite'`。刪除 `viewerAccess` 陣列鏡像（改由 `listAccessiblePages` 即時聯集）。
- 新增**群組邀請**：`groups/{groupId}/members` 授權可由 group 管理者（或 super-admin）指派，總會窗口一次拿到旗下所有分會的角色。

---

## 7. 分階段落地 roadmap

> 每階段獨立可上線、可回溯相容；照 CLAUDE.md 紀律 tsc/eslint/build 三關 + localhost 驗證 + 兩粉專交叉隔離測試才 commit。

| 階段 | 內容 | 產物 | 相依 |
|---|---|---|---|
| **A. 授權層地基** | `lib/auth/roles.ts`（角色×能力矩陣）+ `lib/auth/access.ts`（`getUserPageAccess`/`can`/`requireCapability`/`listAccessiblePages`）；`/api/user/role` 回 role+capabilities（相容舊欄位）。**先不改資料**，access 層讀舊集合。 | 集中授權介面上線，行為與現況等價 | — |
| **B. 統一成員模型 + 遷移** | backfill 腳本；`members` 成唯一來源；`resolvePageOwnerUid`/`access.ts` 改讀 `members`（保留 fallback）。各資料 API 換成 `requireCapability`。 | 修掉「兩個事實來源」+ 三份 viewer 權限 | A |
| **C. 能力閘門套到功能頁** | UI `show: isAdmin` → `show: can(cap)`；messages/drafts/links/sidekick/sync 各自 capability；**Editor/Approver 發布分離**接進草稿狀態機。 | 新功能有細分權限；發布把關到位 | B |
| **D. 群組標籤** | `groups` schema + group 授權；`listAccessiblePages` 聯集 group；群組管理 UI（super-admin/總會）；群組邀請。 | 總會一次看旗下所有分會 | B |
| **E. 稽核 + 成員 UX** | `auditLog` 寫入（成員/發布/自動發布/設定）；成員頁改角色下拉 + 稽核檢視。 | 開放寫入後的信任與可追溯 | C |
| **F.（未來）廣告自動發布把關** | `ads.automate` capability 綁進 Phase 4 寫入流程 + HITL + audit。 | 與 Phase 4 對接 | C, E |
| **G.（未來）Entitlement / 計費** | `lib/billing/entitlements.ts`（plan→feature）+ `canUse`（能力 AND 方案）組合閘門；`pages/{pageId}.plan`；UI 未解鎖顯示升級。金流串接另議。**不需 org**。 | freemium 上線 | A（能力層），可與 C 併行 |

清理（移除 `admins`/`viewerAccess` 舊路徑）排在 B 驗證通過後的下一個 release。

---

## 8. 風險與注意事項

- **跨頁隔離不可退化**：group 授權是新的跨頁入口，`getUserPageAccess` 必須確保「group role 只作用在該 group 內的 pageId」，且回傳資料仍 page-scoped。新增 group 功能時，沿用 CLAUDE.md 的兩粉專交叉測試當 release 關卡。
- **super-admin 維持唯讀 god-mode**：接進 `access.ts` 後仍只給讀，寫入/發布動作即使 super-admin 也應留 audit。
- **遷移期雙來源**：backfill 未完成前，`members` 與 `admins`/`viewerAccess` 並存，務必以 `members` 優先、舊集合僅 fallback，避免權限「加倍」或「消失」。
- **Owner 移轉/離開**：目前無 owner 移轉流程；`page.admin` 能力預留，但實際 UI/流程排在 E 之後視需要再做。
- **無 firestore.rules 不變**：全走 BFF，`access.ts` 是唯一守門，任何新 route 都必須經過它——這點要寫進 CLAUDE.md 當硬規則。

---

## 9. 決策紀錄與待確認

### 已定（2026-07-08）
- **角色 = 4 個**：Owner / Admin / Editor / Viewer（Approver 併 Admin、Analyst 併 Viewer）。
- **組織模型 = Group**，Organization 未來預留（§2.6 準則）。
- **總會窗口 = group 層 Viewer**（唯讀廣告/貼文/連結分析，**不含私訊**）。
- **對外發佈統一為 capability 家族**：`content.publish`(貼文) / `ads.automate`(廣告) / `chatbot.deploy`(bot 上線) 皆 Admin+；角色維持 4 個，未來對外功能=新增 capability 不新增角色。
- **私訊拆兩層能力**（`analytics.messages` 統計、`messages.read` 原始），皆 Editor+，Viewer 不碰。
- **Chatbot（未來 Phase 5）**：`chatbot.manage`(設定/訓練/測試)=Editor+、`chatbot.deploy`(上線)=Admin+，沿用「草擬→核准上線」分離。
- **計費 = 第三軸（Entitlement），與 RBAC/Group 正交**（§2.7）：freemium，功能可用=`can()` AND `isEntitled()`；收費主體掛粉專（建議）或帳號，**不需 org**；現行 Group 架構完全支撐。

### 待確認（實作細節，可晚點定）
1. **group 管理權**：誰能建立 group、把粉專加進 group、指派 group 成員？（建議：super-admin + group 內的 admin）
2. **Viewer 是否含 `sidekick.use`**：Sidekick 有 AI 成本，Viewer 要不要預設可用，還是留給 Editor 以上？（目前設計含）
3. **client 端是否快取 capabilities**：`/api/user/role` 每頁切換都打一次，還是登入時一次拉全部可見頁的 capability map。
4. **per-member capability 覆蓋**：是否要保留「在角色之上針對個別成員加減單一能力」的彈性（例如某 Viewer 額外不給看廣告）。預設不做，需要再補。
