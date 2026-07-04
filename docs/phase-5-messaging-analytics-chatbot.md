# Phase 5 — 私訊分析 + FAQ 自動回覆 Chatbot (Messaging Analytics & Auto-Reply)

> **階段定位**（roadmap：Phase 1–4 已規劃，本文件為新增 Phase 5）：
> - **Phase 1**：Meta OAuth + FB/IG 成效抓取 + 儀表板（✅ 已上線）
> - **Phase 2–4**：通知中心 / Sidekick 自我學習 / 半自動廣告更新
> - **Phase 5（本文件）**：讀 IG/FB 私訊做**數字分析**，並建 **FAQ chatbot** 自動回覆例會時間地點等常見問題。
>
> **核心原則**：這是全新能力面（從「唯讀成效」跨到「讀寫私訊」）。**與現行 8 權限 App Review 完全隔離，不混送。**先做唯讀分析（5-1），再做自動回覆（5-2）。

```
[用戶私訊 IG/FB]
      │
      ├─(5-1 唯讀)→ /conversations 列舉 → 存 messages 快照 → 統計儀表板（每日則數 / 人數 / 常見問題分類）
      │
      └─(5-2 讀寫)→ webhook `messages` 事件 → bot 分類意圖 → 命中 FAQ 就自動回覆（Send API）
                                                    └─ 沒命中 → 標記轉真人（human_agent 7 天窗）
```

---

## 0. ⚠️ 送審與前置條件（先讀這段）

| 項目 | 5-1 私訊分析 | 5-2 自動回覆 chatbot |
|------|------------|--------------------|
| **權限** | `instagram_manage_messages`、`pages_messaging` | 同左 + webhook 訂閱 `messages` |
| **讀/寫** | 唯讀（只列舉、不回訊息） | 讀 + **寫**（發送回覆） |
| **App Review** | 需單獨送 messaging 權限 | 同批或再送一次 |
| **Business Verification** | 幾乎必要 | 必要 |
| **風險** | 中（讀敏感個資） | 高（自動對外發訊息） |

**關鍵限制與規則**：
1. **messaging 權限是 Meta 審查最嚴的一類**，且需要**商家驗證（Business Verification）**。→ 不可混進現行唯讀權限的送審批次。
2. **24 小時訊息窗**：Meta 規定收到用戶訊息後，一般只能在 **24 小時內**自由回覆；超過需符合特定訊息標籤。bot「即時自動回覆」在窗內，沒問題。
3. **`human_agent` 標籤（截圖看到的 Human Agent 功能）**：把回覆窗延長到 **7 天**，供「先 bot、後轉真人客服」場景用。bot 純自動回覆用不到；規劃「轉真人」時才需要它。
4. **沒有現成的「私訊數量」insight 指標**——DM 統計要自己列舉 `/conversations` 逐則計算，非 insights API。
5. **隱私政策要補**：讀取用戶私訊屬高敏個資，`/privacy` 要新增「訊息內容、如何使用、保存期限、刪除方式」段落；`/data-deletion` 流程要涵蓋訊息資料。

---

## 1. 目標與範圍 (Scope)

### In scope
- **5-1 私訊分析（唯讀）**
  1. 定時列舉 IG/FB 對話，抽出訊息 metadata（誰、何時、內容），存 page-scoped 快照。
  2. 儀表板呈現：每日/每週私訊則數、發問人數、平均回覆時間、常見問題分類（用既有 LLM 分群）。
  3. 產出「最常被問的問題」清單 → 成為 5-2 FAQ 的資料來源。
- **5-2 FAQ chatbot（讀寫）**
  1. Webhook 接 `messages` 事件。
  2. 意圖分類：命中 FAQ（例會時間、地點、如何加入、費用…）→ 自動回覆固定/半動態答案。
  3. 沒命中或低信心 → 不亂答，標記待真人回覆（可選 `human_agent`）。

### Out of scope
- ❌ 開放式閒聊 bot（只答預先定義的 FAQ，降低亂答風險與審查難度）。
- ❌ 主動群發 / 行銷推播（違反 24h 窗規則，且審查地雷）。
- ❌ 跨頁混合私訊（嚴守 pageId 隔離，見 §6）。

---

## 2. 5-1 私訊分析（唯讀）

### 資料來源 API
- **IG**：`GET /{ig-user-id}/conversations?platform=instagram`
  → 每個對話 `?fields=participants,messages{from,to,message,created_time}`
- **FB**：`GET /{page-id}/conversations`
  → 同上結構
- **注意**：分頁（cursor）、rate limit；只能讀時間窗內訊息 → 需增量抓、存快照累積歷史。

### 觸發
- 獨立 cron `/api/cron/sync-messages`（GitHub Actions，例如每 2–4 小時），接在既有 sync 節奏後。
- 增量：記錄每頁 `lastMessageTime`，只抓新的。

### Firestore 資料模型（page-scoped，嚴守隔離）
```
users/{uid}/pages/{pageId}/conversations/{conversationId}
  platform: 'IG' | 'FB'
  participantCount, lastMessageTime
users/{uid}/pages/{pageId}/conversations/{conversationId}/messages/{messageId}
  from, createdTime, text, direction: 'inbound' | 'outbound'
users/{uid}/pages/{pageId}/messageStats/daily__{YYYY-MM-DD}
  inboundCount, uniqueSenders, avgFirstReplyMinutes, topIntents[]
```
> 訊息內容為高敏個資 → 考慮只存分析所需欄位、設保存期限（TTL）、或只存分類標籤不存原文（隱私最小化）。

### 儀表板
- 新 vertical：`/dashboard/messages`（或掛進總覽）
- 卡片：本週私訊則數、發問人數、平均首次回覆時間、常見問題 Top 5（LLM 分群，沿用 Phase 3 的 Gemini/Claude 分類手法）。
- 接 `<AiSidekick pageId=...>`，`contextPage="messages"`（依 CLAUDE.md 規則必傳 pageId）。

---

## 3. 5-2 FAQ Chatbot（讀寫）

### Webhook
- 端點：Firebase Cloud Function（需常駐、對外、可被 Meta 呼叫）→ 訂閱 `messages` 欄位。
- 驗證：Meta webhook 的 `hub.verify_token` + `X-Hub-Signature-256` 簽章驗證（用 App Secret）。
- 流程：收到訊息 → 存 Firestore（沿用 5-1 model，標 inbound）→ 丟進意圖分類 → 決定回覆或轉真人。

### 意圖分類 + 回覆
- **FAQ 定義檔**（每 pageId 一份，owner 可編輯）：
  ```
  pages/{pageId}/faqBot/config
    enabled: boolean
    faqs: [{ intent, patterns/examples, answer, needsHuman }]
    fallbackMessage, humanHandoffEnabled
  ```
- **分類**：用 LLM（低成本模型，如 gemini-2.5-flash / claude-haiku）判斷 inbound 訊息命中哪個 intent + 信心分。
- **回覆**：命中且高信心 → Send API 回固定/模板答案（例會時間地點可帶動態欄位）。
- **保守策略**：低信心/未命中 → **不自動回覆內容**，只回「已收到，稍後由真人回覆」並標記 handoff（避免亂答，也對審查友善）。

### Send API
- IG：`POST /{ig-user-id}/messages`　FB：`POST /{page-id}/messages`
- 必須在 24h 窗內；超窗才需訊息標籤 / `human_agent`。

### 安全
- owner 可**全域關閉** bot（config.enabled）與**逐 FAQ 停用**。
- 所有自動回覆存檔（outbound）+ 可在儀表板審閱「bot 回了什麼」。

---

## 4. App Review 交付（Phase 5 專屬，之後才送）
- 錄 screencast：真實用戶私訊 → 5-1 儀表板出現統計；5-2 bot 自動回覆全流程。
- 權限用途英文說明（messaging 權限各一段）。
- 補 `/privacy`：訊息內容蒐集/使用/保存/刪除；`/data-deletion` 涵蓋訊息。
- 完成 Business Verification。
- 測試帳號 + reviewer 指示（沿用現行做法）。

---

## 5. 建置順序（建議）
1. **先 5-1（唯讀分析）**：風險最低、有數據就能展示、且產出「最常被問的問題」→ 直接餵給 5-2 的 FAQ，bot 才答得準。
2. 5-1 送審過關、實際累積資料後，再做 **5-2（自動回覆）**。
3. 5-2 先上「命中才回、否則轉真人」的保守版，穩定後再擴充動態答案。

---

## 6. 🔒 隔離與合規檢查（release 前必過）
- **pageId 隔離**：所有 conversations / messages / stats 一律 `users/{uid}/pages/{pageId}/...`，禁走無 page 區隔路徑（見 CLAUDE.md「多粉專資料隔離鐵則」）。同一 admin 管多粉專時，A 頁看不到 B 頁任何私訊。
- **權限驗證**：讀私訊的 API route 先驗此 user 對該 pageId 有權（admin `metaTokens/{pageId}` / viewer `viewerAccess`）。
- **隱私最小化**：只存分析必要欄位，設 TTL，優先存分類標籤而非原文。
- **bot 可關**：owner 隨時可全域/逐項停用自動回覆。

---

## 變更紀錄
- 2026-07-05：新增本文件（Phase 5 規劃，尚未動工；等現行 8 權限 App Review 送出後再啟動）。
