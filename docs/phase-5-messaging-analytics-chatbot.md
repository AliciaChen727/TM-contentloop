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

## 7. 詳細計畫 — 5-1 擴充（問題分類 + 歷史存檔）

> **現況（`4c3d485` 已上線）**：5-1 是「即時抓、不存檔」的唯讀統計（則數/人數/對話數/每日趨勢/最近對話）。**限制**：每對話只抓最近 100 則→歷史低估；**沒抓訊息文字**→無法分類；每次載入即時打 Graph→較慢。

### 7.1 為什麼擴充要一起做「存檔」
「問題分類」需要**訊息文字**，而目前 5-1 只抓 `created_time`+`from`，沒抓 `message` 內容。要分類就得抓文字；抓了文字若不存，每次載入都要重打 + 重跑 LLM（貴又慢）。因此**問題分類 = 抓文字 + 存檔 + 分類快取**，三者綁在一起，這一刀把原本 deferred 的 cron 存檔一併做掉。

### 7.2 Cron 增量存檔
- 新 `app/api/cron/sync-messages`（GitHub Actions，每 4–6 小時；接在既有 sync 節奏後）。
- 增量：記 per-page `lastMessageTime`，只抓新訊息、翻頁補歷史。
- Firestore（page-scoped，嚴守隔離）：
  ```
  users/{uid}/pages/{pageId}/msgConversations/{convId}
    platform, participantName, lastMessageTime, totalCount
  users/{uid}/pages/{pageId}/msgConversations/{convId}/items/{msgId}
    direction: inbound|outbound, from, createdTime,
    text?          # 視隱私選項決定存不存原文（見 7.4）
    intent, intentConfidence   # 分類結果
  users/{uid}/pages/{pageId}/messageStats/daily__{YYYY-MM-DD}
    inboundCount, uniqueSenders, avgFirstReplyMinutes, intentCounts{...}
  ```

### 7.3 問題分類（intent classification）
- **分類器**：低成本模型（`gemini-2.5-flash` thinkingBudget 0，或 `claude-haiku-4-5`），對每則 **inbound** 訊息判 intent + 信心分。走**批次**（cron 時分類新訊息），不在使用者請求時即時算 → 控成本。
- **意圖分類法（初版，TM 分會情境；owner 可調）**：
  `例會時間` / `例會地點` / `如何加入·報名` / `費用·價格` / `體驗·初次參加` / `聯絡·其他窗口` / `其他`
- **儀表板新增**：
  - 「**常見問題 Top N**」長條圖/清單（依 intent 分群計數，可點看該類對話）
  - 「**平均首次回覆時間**」（inbound→第一則 outbound 的中位/平均）
  - 選配：「**尖峰時段**」熱圖（哪個時段最多私訊）
- **這是 5-2 的燃料**：Top 問題直接告訴你 FAQ 要先答哪幾題、答案怎麼寫。

### 7.4 🔑 關鍵決策：訊息原文要不要存？（分類前必須定）
分類需要文字。三種取捨：

| 選項 | 做法 | 優點 | 代價 |
|------|------|------|------|
| **A. 存原文 + 短 TTL** | Firestore 存 `text`，設 90/180 天 TTL | 可回溯、可重分類、可餵 5-2 few-shot、debug 容易 | 需補 `/privacy`「訊息內容蒐集/保存/刪除」+ `/data-deletion` 涵蓋；資料敏感度最高 |
| **B. 只存 intent 標籤（不存原文）** | 分類後只留 `intent`，丟棄文字 | 隱私最小化、審查最友善 | 無法回溯/重分類；分類法一改要重抓 |
| **C. 完全 live 不存** | 每次載入即時抓+分類 | 完全不存敏感資料 | 每次都貴+慢；不可行於 Top 問題長期統計 |

> **建議 A**（存原文 + TTL）：分類品質、5-2 FAQ 訓練、debug 都靠它；隱私靠 TTL + 政策補件 + owner 可刪來守。若你偏保守可選 B。**C 不建議**。

**✅ 決策（2026-07-05，使用者拍板）：採 A — 存原文 + 短 TTL。** 實作要點：
- 存 `text`（inbound + outbound 都存，回覆時間差要算首次回覆）。
- **TTL 180 天**：Firestore TTL policy 掛在 `items` 的 `expireAt` 欄位（寫入時 = createdTime + 180d），到期自動刪。
- **隱私補件（存原文前必做）**：`/privacy` 新增「訊息內容：蒐集範圍、用途（統計+分類+自動回覆）、保存 180 天、如何刪除」；`/data-deletion` 流程涵蓋訊息資料。
- **owner 可手動清除**：設定頁提供「刪除此粉專所有已存私訊」按鈕（一次清空 page-scoped 訊息）。
- 隔離照舊：一律 `users/{uid}/pages/{pageId}/...`，跨頁不混。

### 7.5 5-1 擴充驗收
- Top 問題數字合理、點得進該類對話；平均回覆時間有值。
- cron 增量正確（不重複、補得到歷史）。
- 跨頁隔離：A 粉專的分類/訊息不出現在 B。
- （若選 A）隱私政策 + 資料刪除已補、TTL 生效。

---

## 8. 詳細計畫 — 5-2 AI Agent 自動回覆（讀寫）範圍

> **前置**：5-1 擴充上線、累積夠資料知道「最常被問什麼」後才做。messaging **寫入**（Send API）+ webhook + **商家驗證** → 單獨 App Review。

### 8.0 定位與架構（2026-07-05 修訂：AI agent + 平台無關）
不做「死板固定模板」，做 **AI agent**：以 owner 填的知識庫（per-intent 答案 + 補充知識 + 語氣/persona）為 **grounding**，用 LLM **生成**自然回覆（RAG-style，grounded 以防亂編）；沒把握/無對應知識 → 轉真人（不亂答）。

**平台無關架構（為了未來 LINE）**：
```
Agent 核心（platform-agnostic）：(用戶訊息, 粉專知識庫) → 回覆文字
   ├── Meta adapter：Send API（FB Messenger / IG DM）← 本階段
   └── LINE adapter：LINE Messaging API              ← 未來評估後接
```
核心只產「回覆文字」，發送交平台 adapter → 加 LINE 不用重寫核心、只加一個 adapter。

**LINE 可行性評估**：技術可行（LINE Messaging API + webhook + reply/push）。需 LINE 官方帳號 + Messaging API channel + channel access token + 設 webhook。**不需 Meta App Review、不需商家驗證**（LINE 自有體系，可能比 Meta 那條更快上線）。屬獨立 adapter 刀，與 Meta 完全分開，不影響現階段。

**建置子刀**：5-2a FAQ/知識庫設定 UI（零風險、無 Meta 設定，✅ 進行中）→ 5-2b webhook + agent 回覆引擎（dry-run 不真發）→ 5-2c 真發送（Send API，owner 逐頁開啟）→ 5-2d（未來）LINE adapter。

### 8.1 In scope（第一版刻意保守）
1. **Webhook 接收**（Firebase Cloud Function）：訂閱 `messages` 事件；驗 `hub.verify_token` + `X-Hub-Signature-256`（App Secret）。收到 inbound → 存 Firestore（沿用 7.2 model）→ 分類 intent。
2. **FAQ 設定**（owner 可編輯，`pages/{pageId}/faqBot/config`）：
   ```
   enabled: boolean
   humanHandoffEnabled: boolean
   fallbackMessage: string
   faqs: [{ intent, answer, dynamicFields?, needsHuman }]
   ```
3. **回覆決策**：
   - 命中 FAQ **且高信心** → Send API 回模板答案（例會時間/地點可帶動態欄位）。
   - 低信心 / 未命中 → **不亂答**，回 `fallbackMessage`（「已收到，稍後由真人回覆」）並標記 handoff。
4. **控制與稽核**：owner 可**全域關 bot**、**逐 FAQ 停用**；所有 outbound 自動回覆存檔，儀表板可審閱「bot 回了什麼」。
5. **合規**：遵守 **24 小時訊息窗**（窗內自由回；超窗才需訊息標籤 / `human_agent`）。

### 8.2 Out of scope（第一版不做）
- ❌ 開放式閒聊/生成式自由對話（只答預定 FAQ，降風險 + 好過審）。
- ❌ 主動群發 / 行銷推播（違反 24h 窗，審查地雷）。
- ❌ 自動轉真人客服的複雜工單系統（先只「標記 handoff」）。

### 8.3 Send API
- IG：`POST /{ig-user-id}/messages`；FB：`POST /{page-id}/messages`。
- 需 scope 升級為可寫（`instagram_manage_messages` 已含回覆能力；FB 用 `pages_messaging`）。

### 8.4 5-2 App Review 交付
- 錄 screencast：真實用戶私訊 → bot 命中 FAQ 自動回覆 / 未命中轉真人 全流程。
- messaging 寫入權限用途說明（英文）。
- 完成 **Business Verification**。
- `/privacy` 補「自動回覆如何運作、訊息如何處理」。

### 8.5 例會排程輸入（已做三種匯入）
三種匯入殊途同歸（都 → `parseSchedule` → `faqBot/config.scheduleEntries` → `nextMeeting()` 算下次）：
1. **貼上**（Google Sheet/Excel 複製 = TSV，或自由文字）。
2. **CSV 上傳**（client 端讀檔，逗號轉 tab 後解析；`page.tsx` `onCsvFile`）。
3. **Google Sheets 同步**（SA-share，非 OAuth）：`lib/messages/sheetsClient.ts`（`GoogleAuth` + scope `spreadsheets.readonly`，讀 gid→title→values，flatten→parseSchedule）+ `app/api/messages/faq/sheet`（GET 回 SA email、POST 同步）。sheetUrl 存 `config.scheduleSheetUrl` 可重同步。

**🔑 SA-share 交付規則（多管理者必讀）**：
- **所有粉專管理者都共用「同一個」service account email** 當檢視者（與 GA4 同帳號 `firebase-adminsdk-fbsvc@contentloop-dev.iam.gserviceaccount.com`，即 `FIREBASE_ADMIN_CLIENT_EMAIL`）。每人只把**自己的表**授唯讀；ContentLoop 只讀有被共用的表；sheetUrl 存 per-page、只有該頁 admin 能同步。
- **前置（一次性）**：GCP 專案 `contentloop-dev` 需**啟用 Google Sheets API**。
- **未來可換專用最小權限 SA**：程式已支援 `GA_SA_CLIENT_EMAIL`/`GA_SA_PRIVATE_KEY`（`sheetsServiceAccountEmail()` 與 `resolveSa` 同邏輯，優先專用 SA）。換了之後設定頁會顯示新 email，管理者改共用給新帳號即可。設定頁 UI 已寫明此規則。
- **殘留風險（小）**：知道某張「已共用給 SA」的表網址的 admin，理論上可同步進自己粉專。對排程資料風險低；放更敏感資料再加「網址綁定粉專」驗證。

### 8.6 知識庫涵蓋非常規活動（自訂問答）
- 8 個意圖是「常規類別」。**非常規/一次性活動**（特別講座、台韓交流會、比賽…）用兩層涵蓋：
  1. **補充知識（free text，5-2a 已有）**：owner 隨手寫任何活動資訊，agent grounding 時一併參考——已能處理大部分臨時問題。
  2. **自訂問答（未來 5-2b+ 加）**：`faqBot/config.customFaqs: [{keywords[], question, answer, enabled}]`，讓 owner 針對「反覆被問的特定一次性活動」建結構化 Q&A；agent 先比對 customFaqs，再落回 8 意圖答案，再落回補充知識。
- **agent 決策順序**：例會排程（deterministic）→ 自訂問答 → 意圖答案 → 補充知識 grounding →（都不足）轉真人。

### 8.7 回覆品質 + 模型路由（任務路由）
| 任務 | 模型 | 理由 |
|------|------|------|
| 意圖分類（已上線） | `gemini-2.5-flash`（thinkingBudget 0） | 便宜快、結構化 |
| 「下次例會」等日期/事實 | **純程式**（`nextMeeting()`） | 100% 正確，不讓 LLM 算日期 |
| **回覆生成（5-2b）— 標準** | **`claude-haiku-4-5`**（預設） | 便宜、品牌語氣安全，grounded FAQ 綽綽有餘 |
| **回覆生成 — 進階** | `claude-sonnet-4-6`（owner 可切） | 難題/細緻語氣；貴一點 |
- **設定頁加「回覆品質：標準 / 進階」開關** → 對應 haiku / sonnet，存 `faqBot/config.replyModel`。
- **路由邏輯**：分類(flash) → 命中排程/自訂/意圖/知識 → 用 replyModel 生成 → 否則轉真人。所有 outbound 存檔可審閱。

### 8.8 Grounding 修正（脆弱點）+ AI 優化迴圈（回饋 → 改進）

**🐛 已知脆弱點（要先修）：grounding 被單一意圖卡死。**
現況 `replyAgent` 只餵「被分類到的那個意圖」的答案。分類跑掉（例：「有提供餐點嗎」被歸 `other` 而非 `event_content`）→ 漏掉該格答案 → 誤轉真人。
**修法**：grounding 改「**全餵**」——把**所有啟用的意圖答案（附主題標籤）+ 補充知識 + 排程事實**一起給 LLM，讓它自己挑相關資訊；意圖分類只留給「排程注入 + 分析統計」，**不再用來 gate 答案**。附「若都不相關才轉真人」指示（LLM 輸出 `[[HANDOFF]]` sentinel → action=handoff）。→ 更 RAG、抗分類雜訊。

**AI 優化迴圈（三層，由確定到自動）：**
| 層 | 機制 | 生效 | 狀態 |
|----|------|------|------|
| **T1 更正即知識** | 倒讚寫更正 → 一鍵/自動存進 `faqBot/config.corrections[]`（一律納入 grounding） | **當下、確定** | 要做 |
| **T2 回饋週報** | 統計最常被倒讚的意圖/問句 → 提示 owner「這幾題該補答案」；可 AI 建議草稿，owner 一鍵採納進答案/知識 | 半自動 | 之後 |
| **T3 few-shot 自我學習** | 讚=正例、倒讚+更正=負例/修正例，存向量檢索；回覆時檢索相似歷史當 few-shot 回填 prompt（同 Phase 3 evaluator/feedbackRetrieval） | 自動、漸進 | 之後 |

- **`corrections[]`**（T1）：`{ text, fromMessage, createdAt, by }`；`replyAgent` 永遠把 corrections 併進 grounding（優先序高於一般知識）。→ 倒讚更正**下一次同問題就生效**。
- 回饋已存 `faqBot/config/feedbackItems`（rating/reason/message/reply/intent），T2/T3 直接用這份。
- **決策順序（修正後）**：排程(程式) → corrections → 所有意圖答案 + 補充知識（全餵 LLM）→ 都不相關 → 轉真人。

**建議先做**：①grounding 全餵（修脆弱點，餐點問題當下就好）②T1 更正即知識（讓倒讚真的有用）。T2/T3 累積回饋後再上。

---

## 9. 建議順序（更新版）
1. **5-1 擴充**：先定 7.4 存原文選項 → cron 存檔 + 問題分類 + Top 問題儀表板（+ 隱私補件）。
2. 累積 2–4 週資料、確認 Top 問題穩定。
3. **5-2**：FAQ 設定 UI → webhook → 保守版自動回覆（命中才回、否則 handoff）→ 單獨送審 + 商家驗證。
4. 穩定後再擴：動態答案、尖峰時段、轉真人流程。

---

## 變更紀錄
- 2026-07-05：新增本文件（Phase 5 規劃）。5-1 私訊分析（唯讀）已上線（commit `d1fe863`/`4c3d485`）。
- 2026-07-05：補 §7–§9 詳細計畫——5-1 擴充（問題分類 + cron 存檔 + 原文儲存決策 A/B/C）與 5-2 FAQ chatbot 範圍。尚未動工。
