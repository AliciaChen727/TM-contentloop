# ContentLoop — 專案世界觀 (AGENTS.md)

## 專案定位
Toastmasters 分會用的 AI 廣告／內容成效儀表板。從 FB 粉專 + 連動 IG 抓貼文/廣告成效，存 Firestore，用 Next.js 儀表板呈現，並提供 AI 診斷、洞察報告、AI Sidekick 與廣告異常通知。

**現況**：Phase 1（資料抓取 + 儀表板）已上線。目前在做通知 → 優化 → 自動化的 roadmap。

> 📌 **維護規範**：每次「重大程式改動」（新功能 / 改架構 / 改診斷規則 / 加改 API / 加外部整合 / 改部署）或「memory 更新」，都要回頭更新根目錄 `README.md` 對應章節，並在其 [變更紀錄] 補一行（日期 + 摘要 + commit）。小修字不必。

## Roadmap（單一事實來源在 `docs/`）
| Phase | 內容 | 文件 |
|-------|------|------|
| 1 | Meta OAuth + 定時抓 FB/IG 成效 + 儀表板 | ✅ 已上線 |
| 2 | 站內通知中心（紅點）+ 排程 email 告警 | ✅ `docs/phase-2-notification-center.md` |
| 3 | AI Sidekick 優化 loop + 自我學習（批次審查 agent / Quality evaluator / feedback memory；agent = **Anthropic 原生**，非 LangChain）| 📋 `docs/phase-3-sidekick-self-learning.md` |
| 4 | 半自動廣告更新（Meta Marketing API 寫入，需 `ads_management` + App Review）| 📋 `docs/phase-4-ad-automation.md` |

系統架構詳見 `docs/architecture.md`；廣告目標→指標對照見 `docs/goal-metrics.md`。

## 開發指令（monorepo：程式在 `apps/web`）
```bash
cd apps/web
npm run dev          # 本機開發
npx tsc --noEmit     # 型別檢查
npx eslint <files>   # lint
npm run build        # production build（commit/push 前務必跑過）
```
**紀律**：每次改完 → `tsc` + `eslint` + `next build` 三關全綠才 commit。部署：push `main` → Vercel 自動部署（前端）；`functions/` 變更 → Firebase deploy。

## 技術棧
| 層 | 技術 |
|---|---|
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| 後端 | Firebase Cloud Functions (Node.js 20, TypeScript) |
| 資料庫 | Firestore |
| 身份驗證 | Firebase Auth + Meta OAuth 2.0 |
| 外部 API | Meta Graph API (FB Page Insights + IG Business Insights) |
| 部署 | Vercel (前端) + Firebase (後端) |

## 環境資訊
- Firebase 專案：`contentloop-dev`（Blaze plan）
- Meta App：Business 類型，Development mode
- FB Page：TM 分會粉專（使用者為 Admin）
- IG：Business 帳號，已連動上述 Page

## 協作規則（AI 行為準則）
1. **重大決策前先問**，不自作主張
2. **先規劃 → 使用者確認 → 再寫 code**
3. **一次完成一個 vertical slice**，不東改西改
4. **每個檔案職責單一**，component 不超過 200 行
5. 所有 secret / token 只存 `.env.local`（前端）或 Firebase Secret Manager（後端），絕不 commit
6. **部署流程：程式改完 → 跑三關 → 先在 localhost（`npm run dev`，http://localhost:3000）給使用者測 → 等使用者回「OK」→ 才 commit git + push（Vercel 自動部署）。不要自己先 push。** 純文件（README/docs/memory）類改動可豁免 localhost 步驟。詳見 memory `feedback_deploy_flow`。

## Firestore 資料模型（草案）
```
users/{uid}
  metaTokens/page          # Page access token (encrypted)
  fbPosts/{postId}         # FB 貼文成效快照
  igPosts/{mediaId}        # IG 貼文成效快照
```

## 命名慣例
- 資料夾：kebab-case
- 元件：PascalCase
- 工具函式：camelCase
- Firestore collection：camelCase 複數（`fbPosts`, `igPosts`）

## AI Sidekick 整合規則（新增儀表板必讀）

每個儀表板頁面使用 `<AiSidekick>` 時，**必須傳入 `pageId` prop**，否則：
- 對話不會存進 `pages/{pageId}/sidekickConversations`
- 歷史面板顯示「尚無歷史紀錄」
- Owner 看不到「匯出」按鈕

### 正確寫法
```tsx
<AiSidekick
  open={skOpen}
  onClose={() => setSkOpen(false)}
  contextPage="posts"          // 或 "overview" / "creative" / "diagnosis" 等
  pageId={pageData?.pageId ?? undefined}   // ← 必須加
  metricsContext={...}
/>
```

### 已整合的儀表板
| 頁面 | 檔案 | contextPage |
|---|---|---|
| 廣告儀表板 | `apps/web/app/dashboard/ads/page.tsx` | overview / diagnosis / creative 等 |
| 內容表現 | `apps/web/app/dashboard/page.tsx` | posts |

### Firestore 路徑
- 有 `pageId`：`pages/{pageId}/sidekickConversations/{sessionId}`（對話存檔、歷史、CSV 匯出）
- 無 `pageId`：fallback 讀 `users/{uid}/aiInsights`（舊系統，不支援匯出）

## ✍️ AI 文案生成換行規則（Content Drafts）

`AI 生成文案` 必須支援自然段落換行，避免所有貼文被壓成單行。

- 生成 API：`apps/web/app/api/ai/caption/route.ts`
  - prompt 必須允許/鼓勵自然段落換行（hook、重點資訊、CTA 可分段）。
  - 多平台模式回傳 JSON 時，字串內換行應使用 `\n`；解析端需容忍模型偶爾回傳 raw newline。
- 前端輸入/預覽：
  - `components/content/DraftComposer.tsx` 的 textarea 直接保存 newline。
  - `components/content/PostPreview.tsx` / `components/content/DraftCard.tsx` 顯示文案時需保留 `whitespace-pre-wrap`。
- 草稿與發布：
  - `generated.perPlatform[*].body` 要保留原始 `\n`。
  - 發布時 `lib/content/publishRunner.ts` 可在 body 與 hashtags 之間再補 `\n\n`，但不可清掉 AI 生成文案本身的換行。

## 🩺 診斷引擎 — 單一事實來源（改規則必讀）

診斷的規則**只有一份**：`apps/web/lib/ads/diagnosis.ts`（純函式，server/client 共用）。
要改診斷門檻/文案，**只動這個檔**，下列三個消費端會同步生效：

| 消費端 | 檔案 | 說明 |
|--------|------|------|
| 診斷建議頁 | `app/dashboard/ads/page.tsx`（`buildAdData`）| 依使用者選的日期區間，client 即時算 |
| 紅點通知 + 告警 email | `lib/alerts/processAlerts.ts` | 用 canonical 快照算；只有 `critical`/`warning` 發通知，`good`-only 靜默 |
| 「AI 投手建議」紫框 | `components/ads/sections/DiagnosisSection.tsx`（`aiSummary`）| 模板字串拼接，**非 LLM**（Phase 3 才升級）|

- **不要**再用 `lib/alerts/detector.ts`（`detectAdAlerts`）當通知來源 —— 已被診斷引擎取代（檔案保留未刪）。
- 診斷存於 `pages/{pageId}/adInsights/latest` 的 `diagnosis` / `diagnosisCounts` / `diagnosisUpdatedAt`，三條路徑更新：每日 cron（`api/cron/sync`）、手動同步（`api/ads/sync`，重算但不覆寫合併 summary）、通知 cron fallback（存的比 `syncedAt` 舊就重算）。
- 診斷頁是「依日期區間即時算」，紅點是「用最新 canonical 快照算」→ **規則同源、日期範圍可能不同**，屬預期行為。

## 🔔 站內通知中心（Phase 2）
- 通知存 per-user：`users/{uid}/notifications/{docId}`，deterministic per-day id `{type}__{pageId}__{dateStr}`（同日冪等、保留已讀狀態）。
- API：`GET /api/notifications`（最近 20 + unreadCount）、`POST /api/notifications/read`（`{id}` | `{all}`），皆用呼叫者自己的 ID token 驗身。
- UI：`components/NotificationBell.tsx` 掛在 dashboard header。BFF 架構（全走 Admin SDK + verifyIdToken）→ **不需要 firestore.rules**。

## 🤖 使用的 Model
- `Codex-sonnet-4-6`：AI Sidekick 對話、洞察報告（`api/insights/report`）
- `Codex-haiku-4-5`：素材生成（`api/ai/creative`）
- 診斷引擎本身 = 規則，**無 model**
- 告警 email：nodemailer + Gmail（寄件者 `courage727@gmail.com`，App Password）

## ⚠️ Legacy Collection 隔離規則（防止跨頁資料洩漏）

Firestore 有兩層 post 資料路徑：

| 路徑 | 類型 | 說明 |
|---|---|---|
| `users/{uid}/fbPosts` | Legacy multi-page | ❌ 所有粉專混在一起 |
| `users/{uid}/igPosts` | Legacy multi-page | ❌ 所有粉專混在一起 |
| `users/{uid}/pages/{pageId}/fbPosts` | Page-scoped | ✅ 安全，只含該粉專 |
| `users/{uid}/pages/{pageId}/igPosts` | Page-scoped | ✅ 安全，只含該粉專 |

**規則**：當 `pageId` 已知時，**絕對不可以**把 legacy collection 無過濾地合併進結果。

- **FB legacy filter**：`doc.id.startsWith(`${pageId}_`)` — doc ID 格式為 `{pageId}_{postId}`
- **IG legacy**：無 page 前綴，有 `pageId` 時**只讀** page-scoped path，不讀 legacy

**已知發生的 bug**：`/api/insights/fb/route.ts` 曾在 2026-05-22 把兩個粉專的 FB 貼文混合顯示，原因正是 legacy fallback 沒有加 prefix filter。

### 🔒 新增粉絲頁前必做的隔離檢查清單

使用者可能同時是多個粉專的 Admin（例如 D67 + Legacy）。**每次新增粉專、或寫任何讀取貼文/廣告/洞察資料的程式碼前**，都必須確認以下每一項：

1. **一律以 `pageId` 為主鍵查詢** — 所有 Firestore 讀寫都走 `users/{uid}/pages/{pageId}/...` 或 `pages/{pageId}/...`，不要走無 page 區隔的 collection。
2. **必要時讀 legacy collection，一定要加 page filter**（FB 用 `${pageId}_` 前綴；IG 有 pageId 時不讀 legacy）。
3. **API route 收到 `pageId` 後要驗權**：admin 查 `metaTokens/{pageId}`、viewer 查 `viewerAccess`，確認此 user 有權看這個粉專才回傳資料。
4. **廣告比對用 `effective_object_story_id` 前綴**（`${pageId}_`），不可只比 short postId（FB post ID 雖全球唯一，但仍應以 pageId 前綴為準）。
5. **新增前先用兩個粉專交叉測試**：切換到 A 粉專不可看到 B 粉專任何貼文 / 廣告 / 對話。

> 跨頁資料洩漏屬於嚴重問題，新增任何粉專相關功能時，隔離測試是 release 前的必要關卡。

### 🚨 隔離適用於「每一個 admin」，不只跨使用者

跨頁隔離**不是只防「A 使用者看到 B 使用者的粉專」**。最容易被忽略的情境是：

> **同一個 admin 同時管理多個粉專（例如同時是 D67 + Legacy 的 Admin），他自己登入時，名下各粉專的數據也絕對不可以混在一起。**

只要請求帶了 `pageId`（或從 token 解析得到 `pageId`），**所有讀取貼文 / 洞察 / 廣告的程式碼都必須以該 `pageId` 為界**，回傳的資料只能屬於這一個粉專。這條規則對 **viewer、admin、owner、super-admin 一律適用**，沒有例外。

具體做法：

1. **有 `pageId` 就走 page-scoped path**：`users/{uid}/pages/{pageId}/fbPosts`、`.../igPosts`，不要直接讀無 page 區隔的 `users/{uid}/fbPosts` / `igPosts`。
2. **必須讀 legacy collection（fallback）時**：FB 一定加 `` `${pageId}_` `` 前綴過濾；IG legacy 無前綴，已知 `pageId` 時**完全不讀** legacy，只讀 page-scoped。
3. **debug / 診斷 / 匯出等「非主流程」端點同樣適用**——它們最常被遺漏。`/api/debug` 曾因直接讀 `users/{uid}/fbPosts`（未加 pageId 過濾），導致管理多粉專的 admin 看到跨頁混合資料，已於修正中改為 page-scoped。
4. **新功能驗收**：用「一個同時管理 A、B 兩粉專的 admin 帳號」登入，切到 A 不可看到任何 B 的貼文 / 廣告 / 數據，反之亦然。

## 🔑 OAuth 連接架構：User-Centric（多粉專 Admin 必讀）

**核心原則**：連接流程一律抓「**連接者自己管理的粉專**」，**絕不寫死單一粉專**。

ContentLoop 未來會給多個粉專 Admin 使用（D67、Legacy、Irene 的職涯教練粉專…），每個人登入後應該看到「自己管理的粉專」，而不是被綁定到某個固定粉專。

### 正確流程（`apps/web/app/api/auth/meta/route.ts`）

```typescript
// 1. 先抓連接者自己的所有粉專（user-centric）
const pageMap = new Map<string, PageToken>()
const ownPages = await getAllManagedPages(longLived).catch(() => [])
for (const p of ownPages) pageMap.set(p.pageId, p)

// 2. META_PAGE_IDENTIFIER 只當「補充」，不是主來源
if (process.env.META_PAGE_IDENTIFIER) {
  const configured = await getPageToken(longLived).catch(() => null)
  if (configured) pageMap.set(configured.pageId, configured)
}

const pages = Array.from(pageMap.values())  // 每人拿到自己管理的粉專
```

### 規則

1. **不可把 `META_PAGE_IDENTIFIER` 當主來源** — 它只是補充（owner 的 `/me/accounts` 不穩時的保險）。先 `getAllManagedPages`，再 merge 設定的粉專。
2. **錯誤訊息不可暴露其他粉專** — 連接失敗時只能說「找不到你管理的粉專」，不可把 D67（或任何特定粉專）的錯誤丟給其他使用者。
3. **OAuth scope 含 `business_management`** — 才能透過 `/me/businesses` 抓到掛在 Business Manager 底下的粉專（見 `connect/page.tsx` SCOPES）。⚠️ 此 scope 對非 Tester 的一般使用者需 App Review。
4. **每個 page token 各存一份** — `users/{uid}/metaTokens/{pageId}`，並把連接者註冊為該粉專 admin（`pages/{pageId}/admins/{uid}`），第一個連接者為 owner。

**已知發生的 bug**：2026-05-22 之前流程是 D67-centric（先 `getPageToken(D67)`），導致非 D67 管理員（Irene）連接時必拿到誤導的 `#100` 錯誤，連不上自己的粉專。
