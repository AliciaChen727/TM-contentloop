# GA4 串接 PoC 規劃（電商廣告/成效 vertical）

## 背景
提琉比長壽村（電商）目前主力用 **Google Ads** 投放，不在 Meta，所以 ContentLoop 的 Meta API 永遠抓不到他近期廣告。要服務這類電商客戶，需新增 **Google 端資料**的 vertical。本 PoC 走 **GA4 Data API**（最省力、無 developer token 審核），且若客戶 GA4 已連結 Google Ads，可一站拿到「網站轉換 + Google 廣告花費/ROAS」。

## 目標（PoC 範圍，求最小可 demo）
用提琉比的 GA4 資料，在 ContentLoop 顯示：各管道（channel）的**工作階段、轉換、營收、ROAS**；若 GA4↔Google Ads 已連結，再加上**廣告花費/點擊**。一個日期區間 → 一張表/卡片。

## 認證方式（PoC 用 Service Account，最快）
- 沿用 owner 既有的 **GCP 專案 + Service Account**（目前 Vertex AI 用的那組，見 [[vertex-ai-decision]]），或新建一個專用 SA。
- 在 GCP 啟用 **Google Analytics Data API**（`analyticsdata.googleapis.com`）。
- **請提琉比把這個 SA 的 email 加進他的 GA4 資源**，角色給 **Viewer（檢視者）** 即可。
- 不走 OAuth（PoC 單一客戶不需要；未來多客戶再升級成 OAuth 各自授權）。

## 需要跟創辦人拿的東西（卡關點，先收集）
1. **GA4 Property ID**（純數字，GA4 管理 → 資源設定，例如 `123456789`）。
2. 把我們的 **Service Account email** 加為該 GA4 資源的 **Viewer**。
3. 確認 **GA4 是否已連結 Google Ads**（GA4 管理 → 產品連結 → Google Ads 連結）。
   - 有連 → 可抓 `advertiserAdCost / advertiserAdClicks / returnOnAdSpend`。
   - 沒連 → 只能抓網站轉換/營收（仍有價值，但無廣告花費）。
4. 確認 GA4 有設定**電商購買事件（purchase）**，不然 `purchaseRevenue` 會是 0。

## 技術設計（對齊現有 BFF 架構）
- **新 API route**：`app/api/ga/report/route.ts`
  - GET，query：`pageId, since, until`（沿用現有日期區間）。
  - 驗身：Bearer ID token + `verifyIdToken`（同其他 route，BFF 原則，client 不直接打 Google）。
  - 用 SA 憑證呼叫 GA4 Data API `runReport`。
- **GA Data API 呼叫**（`@google-analytics/data` 的 `BetaAnalyticsDataClient` 或 REST `runReport`）：
  - dimensions：`date`, `sessionDefaultChannelGroup`（或 `sessionSourceMedium`）
  - metrics：`sessions`, `totalUsers`, `conversions`, `purchaseRevenue`, `ecommercePurchases`
  - （Ads-linked 再加）：`advertiserAdCost`, `advertiserAdClicks`, `returnOnAdSpend`
  - dateRanges：依 since/until
- **設定儲存（per-page、遵守跨頁隔離 [[page-isolation]]）**：
  - `pages/{pageId}.gaPropertyId`（在設定頁填寫；只屬於該粉專/客戶）。
  - 讀取一律以 pageId 為界，A 客戶看不到 B 客戶的 GA。
- **UI**：先做一張「電商成效（GA4）」卡片/區塊（管道營收 + ROAS + 轉換 + 工作階段）。能 demo 即可，之後再細化。
- **快取（可選）**：比照 adInsights 存 `pages/{pageId}/gaInsights/latest`，避免每次打 API。

## 實作步驟（拿到存取權後）
1. GCP 啟用 GA Data API、確認 SA 憑證（Firebase Secret Manager / env）。
2. 在 `pages/{pageId}` 設定頁新增「GA4 Property ID」欄位。
3. 建 `/api/ga/report`（runReport，回管道層級數據）。
4. 建最小 UI 區塊顯示。
5. 用提琉比真實資料驗證（先確認 Ads-linked 與 purchase 事件）。
6. tsc + eslint + build 三關綠 → commit。

## 風險 / 待確認
- GA4 是否連 Google Ads（決定有沒有廣告花費/ROAS）。
- GA4 是否有電商事件（決定有沒有營收）。
- SA 權限是否成功加上（最常卡這）。
- 多客戶擴張時要從 SA 改成 OAuth（PoC 階段先不處理）。

## 面試講法
「我發現這家電商主力在 Google Ads 不在 Meta，所以評估了 GA4 串接：因為 GA4 連結 Google Ads 後能一站拿到花費+轉換+ROAS，且用 service account 授權門檻比 Google Ads API（要審 developer token）低很多。我規劃了一個 service-account 的 PoC，per-page 存 propertyId、走既有 BFF 架構，把電商管道 ROAS 拉進 ContentLoop——這是把產品從 Meta-only 擴張到多平台的第一步。」

---

# 自助串接（讓廣告主自己設定，不用透過 owner）— 分階段

痛點：目前 propertyId + 加 SA 權限都要 owner 代問代設，不可規模化。分兩階段：

## Phase B（現在做）— 設定精靈 + Service Account（半自助、零審核）
廣告主在 ContentLoop 設定頁自己完成，owner 不介入：
1. **複製 SA email**（一鍵）：`firebase-adminsdk-fbsvc@contentloop-dev.iam.gserviceaccount.com`（由後端讀 `FIREBASE_ADMIN_CLIENT_EMAIL` 回傳，不寫死）。
2. 引導他到 GA4「資源存取權管理」把該 email 加為**檢視者**。
3. **貼上 GA4 Property ID** → 存到 `pages/{pageId}.gaPropertyId`。
4. **測試連線**：呼叫現有 `POST /api/analytics/ga/sync`，成功顯示「抓到 N 管道、營收 $X」，失敗回明確錯誤（權限沒加好 / ID 錯）。
- 元件：`components/analytics/GaConnectCard.tsx`（掛在設定頁，admin-only）。
- 端點：`app/api/analytics/ga/config`（GET 讀 propertyId + SA email；POST admin 存 propertyId）。
- 消費端：`GaSection` 接進廣告儀表板導覽，gated on `gaPropertyId` 有設定才出現。
- 優點：零 Google 審核、後端幾乎現成、owner 退出流程。
- 代價：廣告主要手動在 GA4 點幾下加 SA（比 OAuth 多一步）。

## Phase A（規模化再做）— OAuth 自助連接
當「手動加 SA」變成轉換障礙時升級：
1. 設定頁「連接 GA4」→ Google OAuth（scope `analytics.readonly`）。
2. 用 GA Admin API `accountSummaries.list` 列出他的 GA4 資源 → 他選一個。
3. 存**加密 refresh token**（per-page）+ propertyId；同步改用他的 OAuth token（非 SA）。
- 新建：OAuth 流程（authorize/callback）、token 加密儲存與刷新、資源選擇 UI。
- ⚠️ **Google OAuth 應用審核**：`analytics.readonly` 是敏感範圍，給外部一般用戶要過 Google 品牌/安全審查（類似 Meta App Review）；未過前只能加測試用戶。工期主要卡在審核等待。
- 優點：全自助、零手動、可大規模。
- 遷移：Phase B 的 propertyId 設定可沿用；只是把「SA 讀」換成「使用者 OAuth token 讀」。
