# Phase 2 — 站內通知中心 (In-App Notification Center)

> **階段定位**：本系統的 roadmap 統一為 Phase 2 / 3 / 4：
> - **Phase 2（本文件）**：站內通知中心 — 把告警呈現在站內，讓 Admin 不必開信箱就能看到、點進去診斷。
> - **Phase 3**：AI Sidekick 優化 loop — 通知帶優化建議 + 可複製 prompt，一鍵送進 Sidekick 改素材（見 §10）。
> - **Phase 4**：半自動 / 自動化廣告更新 — 串 Meta Marketing API 寫入素材，必過人工審核（獨立文件 `phase-4-ad-automation.md`）。
>
> **前置（已完成）**：email 告警系統 — 廣告異常偵測 + 排程 Gmail 寄信（每週幾 + 幾點，台灣時間，多收件人）。
> Phase 2 與 email 共用同一個偵測來源 (`detectAdAlerts`)，只是多一個 sink。
>
> **更大的定位**：通知中心不只是「提醒」，而是「**從診斷到優化的行動入口**」。
> 通知會帶具體優化建議與可複製 prompt，讓使用者一鍵把「問題 + 素材上下文 + 指令」
> 送進 AI Sidekick 去優化現有素材（human-in-the-loop）。完整路線見 §10 Roadmap。

```
偵測異常 → email 告警(已完成) ┐
detectAdAlerts                ├→ 站內通知 (Phase 2) → 優化建議 + prompt (Phase 3) → AI Sidekick 改素材 → 半自動更新 (Phase 4)
                              ┘        🔔                  ↑ 從「看」變「行動」         人類 in-the-loop      最遠、風險最高
```

---

## 1. 目標與範圍 (Scope)

### In scope（這一階段要做的）
1. **通知資料模型**：Firestore 持久化通知，含已讀狀態、deep link。
2. **產生通知**：複用 `processPageAlerts` 的偵測結果，除了寄信，同時寫入站內通知（fan-out 給該粉專的收件 Admin）。
3. **UI 通知鈴鐺**：header（`ProfileMenu.tsx` 旁）加一個 🔔，含未讀數 badge。
4. **通知面板**：下拉清單，顯示通知標題/時間/粉專名稱，點擊 → 標記已讀 + 跳轉到對應粉專的 AI 診斷。
5. **已讀管理**：單筆標記已讀、全部標記已讀、未讀數即時更新。
6. **權限**：只給該粉專 Admin 看（viewer 不顯示鈴鐺或顯示但無廣告通知），page-scoped。

### Out of scope（明確不做，避免膨脹）
- ❌ 即時推播（WebSocket / FCM push）→ 先用輪詢 + 開頁載入即可。
- ❌ 瀏覽器原生通知 / 手機 App 推播。
- ❌ 通知偏好的細粒度分類訂閱（「只收 CTR 不收頻次」）→ 沿用既有 email 告警的 enable/schedule。
- ❌ 通知歷史的進階搜尋/篩選 → 只做時間排序 + 已讀/未讀。
- ❌ 站內通知獨立排程；它跟著 email 的偵測時機一起產生（見 §5 的選項）。

---

## 2. 通知類型 (Notification Types)

| type | 來源 | 範例文案 (zh-TW) | Deep link |
|------|------|------------------|-----------|
| `ad_anomaly` | **診斷引擎** `buildDiagnosis`（critical / warning 項，見 §2.5） | 「D67：2 項廣告需要注意」 | `/dashboard/ads?pageId={pageId}` |
| `report_ready`（選配） | AI 洞察報告產生完成 | 「Legacy 本週洞察報告已產生」 | `/dashboard/ads?pageId={pageId}&tab=insights` |
| `invite`（選配） | 既有邀請流程 | 「您已被加入 D67 粉專」 | `/dashboard` |
| `system`（選配） | 系統公告 | 「Meta token 即將到期，請重新授權」 | `/dashboard/settings?pageId={pageId}` |

MVP 只做 `ad_anomaly`，其餘類型用同一資料模型，之後加 sink 即可。

---

## 2.5 偵測來源：統一的診斷引擎（重要）

> **變更紀錄**：紅點原本用 `lib/alerts/detector.ts` 的 `detectAdAlerts`（ctr_drop / frequency_high / cpc_spike），
> 與「診斷建議」頁面的 `buildDiagnosis` 是**兩套不同規則**、結論會對不上。已統一成**單一診斷引擎**。

**單一來源**：`apps/web/lib/ads/diagnosis.ts`（純函式，server/client 共用）
- `buildDiagnosis(summary, creatives, budget)` → `DiagItem[]`（severity: `critical` / `warning` / `good`）
- `computeDiagnosisFromSnapshot(snap)` → 從 `adInsights/latest` 快照算（server 用）
- `diagnosisToAlertItems(items)` → 只取 `critical` + `warning` 轉成統一的 `AlertItem`（`lib/alerts/types.ts`）

**三個消費端共用同一引擎**：
| 消費端 | 檔案 | 說明 |
|--------|------|------|
| 診斷建議頁 | `ads/page.tsx` → `buildAdData` | 依使用者選的日期區間，client 即時算 |
| 紅點通知 + email | `processAlerts.ts` | 用 canonical 快照算；`good`-only 不發紅點 |
| AI 投手建議（紫框） | `DiagnosisSection.tsx` `aiSummary` | 模板字串拼接（**非 LLM**，Phase 3 再升級）|

**診斷的「定期更新」三條路徑**（存於 `pages/{pageId}/adInsights/latest` 的 `diagnosis` / `diagnosisCounts` / `diagnosisUpdatedAt`）：
1. 每日 cron sync（`api/cron/sync`）→ 算完存檔
2. 手動「同步廣告資料」（`api/ads/sync`）→ 重讀合併後快照、重算存檔（不覆寫 cron 合併的 summary）
3. 通知 cron（`processAlerts`）→ 存的診斷若比 `syncedAt` 舊就 fallback 重算

**注意**：診斷頁是「依日期區間即時算」，紅點是「用最新 canonical 快照算」—— **規則同源，日期範圍可能不同**，屬預期行為。
診斷規則只需改 `lib/ads/diagnosis.ts` 一處，三個消費端同步生效。

> `lib/alerts/detector.ts` 已不再被通知流程使用（保留檔案，未刪）。

---

## 3. 資料模型 (Firestore)

**決策：per-user 集合**（每位收件 Admin 各存一份），因為：
- 已讀狀態天生 per-user，badge 未讀數 = 一個 `where('read','==',false)` count。
- fan-out 對齊既有 email 收件人邏輯（alertEmails → configuring admin → owner）。
- 查詢簡單，無需 per-user read map。

```
users/{uid}/notifications/{notifId}
  type:        'ad_anomaly' | 'report_ready' | 'invite' | 'system'
  pageId:      string
  pageName:    string          // 中文粉專名（沿用 processAlerts 的 resolve 邏輯）
  title:       string          // 一行標題
  body:        string          // 摘要（幾則、哪些廣告）
  advice:      string          // 具體優化建議（Phase 2 規則產生 / Phase 3 升級為 LLM）
  actionPrompt: string | null  // Phase 3：可複製、丟給 AI Sidekick 的 prompt（已帶素材 context）
  alertKeys:   string[]        // dedup 用（對應 AdAlert.key）
  deepLink:    string          // Phase 2: '/dashboard/ads?pageId=...'；Phase 3: 跳 Sidekick 並預填 prompt
  read:        boolean         // 預設 false
  createdAt:   serverTimestamp
  readAt:      timestamp | null
```

> `advice` 與 `actionPrompt` 是 Phase 3 的核心欄位，但 schema 在 Phase 2 就先預留，
> Phase 2 的 `advice` 用規則 mapping 填（見 §10），`actionPrompt` 先留 null。

**去重**：寫入前查當天同 pageId + 重疊 alertKeys 的未讀通知；存在則更新（不重複轟炸），對齊 email 的 once-per-day guard。沿用 `pages/{pageId}/alertState/current` 的概念，可新增 `lastInAppNotifKeys` / `lastInAppNotifDate`。

---

## 4. API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/notifications` | 回傳目前使用者通知（預設未讀優先 + 時間倒序，limit 20）。回 `{ items, unreadCount }`。 |
| `POST` | `/api/notifications/read` | body `{ id }` 或 `{ all: true }` → 標記已讀（寫 `read=true, readAt`）。 |
| (內部) | `processPageAlerts` 內新增 `writeInAppNotification(recipientUids, ...)` | 與 `sendAlertEmail` 並列的 sink。 |

收件人 UID 解析：既有 email 流程解析的是 email；站內通知需要 **UID**。新增一步把 `alertEmails` → UID（`adminAuth.getUserByEmail`），找不到對應帳號就略過站內（仍寄 email）。`alertConfiguredByUid` 本來就是 UID，直接用。

---

## 5. 通知產生時機（兩個選項）

| 選項 | 做法 | 優點 | 缺點 |
|------|------|------|------|
| **A（推薦）跟著 email 排程** | 在 `processPageAlerts` 寄信成功後，同時寫站內通知 | 一套節流、一致行為、零新增 cron | 站內通知頻率被排程限制（每天最多一次） |
| B 偵測即寫 | 每日 sync 後就寫站內（email 仍照排程） | 站內更即時 | 需要獨立 once-per-day guard、可能與 email 不同步 |

**建議先做 A**：改動最小，且使用者已習慣排程語意。若日後要「站內即時、email 排程」，再升級 B。

---

## 6. UI 設計

- **鈴鐺**：放在 `components/ProfileMenu.tsx` 左側（header 右上）。未讀 > 0 顯示紅點數字（>9 顯示 `9+`）。
- **面板**：點鈴鐺開下拉（寬約 360px）。
  - 每筆：type icon + 標題 + 粉專名 + 相對時間（「2 小時前」）；未讀左側藍點。
  - 點整筆 → `router.push(deepLink)` + 該筆標記已讀。
  - 頂部「全部標為已讀」。
  - 空狀態：「目前沒有通知 🎉」。
- **未讀數更新**：開頁時 `GET /api/notifications`；面板打開時重抓；輪詢可選（每 60s，MVP 可省略）。
- **權限**：非該粉專 Admin（viewer）不顯示廣告類通知；沿用 settings 頁的 `permissions` 判斷。

新增元件：`components/NotificationBell.tsx`（鈴鐺 + 面板，client component）。

---

## 7. 工作拆解 (Tasks)

1. `lib/notifications/store.ts` — `writeInAppNotification()`, dedup guard, email→UID 解析。
2. `processPageAlerts` 串接 sink（選項 A），寫入 fan-out。
3. `GET /api/notifications` + `POST /api/notifications/read`。
4. `components/NotificationBell.tsx` + 接到 `ProfileMenu` 旁。
5. Firestore rules：`users/{uid}/notifications` 只有本人可讀寫已讀欄位。
6. 測試：手動 mint token 打 API；偽造一筆 `ad_anomaly` 驗證 badge / 已讀 / deep link 跳轉正確粉專。
7. 文件：更新本檔 + README 的功能列表。

---

## 8. 風險與注意
- **email→UID 對不上**：收件人填的是非註冊信箱時，站內通知會漏；以 `alertConfiguredByUid` 為主來源較穩。
- **Deep link 粉專**：務必帶 `?pageId=`，沿用既有 email 「AI 診斷」按鈕已修好的同一套 deep link。
- **去重**：別讓站內通知每次 cron 重複新增；用 alertKeys + 當日 guard。
- **Firestore 讀寫成本**：per-user fan-out 在多 Admin 粉專會放大寫入；MVP 規模（2 粉專）無虞。

---

## 9. 驗收標準 (Definition of Done)
- [ ] 偵測到廣告異常且到排程時間 → 收件 Admin 站內出現一筆未讀通知，header 鈴鐺顯示未讀數。
- [ ] 點通知 → 跳到「正確粉專」的 AI 診斷頁，該筆變已讀，未讀數 -1。
- [ ] 「全部標為已讀」清空未讀 badge。
- [ ] viewer 不會看到別人粉專的廣告通知。
- [ ] 同一批異常在同一天不重複產生第二筆。
- [ ] email 與站內通知內容一致（同粉專名、同異常摘要）。

---

## 10. Roadmap — 從通知到素材優化 (Phase 2 / 3 / 4)

通知中心是一條「**偵測 → 提醒 → 建議 → 優化**」價值鏈的中段。
全自動改素材風險高且不成熟，因此採 **human-in-the-loop**：AI 給建議與 prompt，人類按下執行。
分三階段交付，每階段都能獨立上線、各自有 hook，不卡在「全做或沒有」。

### Phase 2 — 通知中心 + 規則優化建議（本文件，現在）
**目標**：把 hook 的「殼」做出來，驗證使用者會不會從通知點進去看建議。
- 站內通知中心（§1–§9 全部）。
- `advice` 直接來自**診斷引擎**的 `DiagItem.action`（規則產生，不接 LLM），與「診斷建議」頁同源（見 §2.5）。
  例：頻率 > 3.5 → 「更換素材 / 擴大受眾」；CTR < 1.5% → 「更換廣告文案或素材」；CPL 偏高 → 「優化 CTA 文案 / 縮小受眾」。
- `actionPrompt` 先留 `null`，deepLink 跳診斷頁。
- **驗收新增**：通知展開後看得到對應的建議文字（= 該診斷項的 action）。
- **驗證假設**：使用者真的會點通知 → 看建議（用點擊率/已讀率判斷是否值得投資 Phase 3）。

### Phase 3 — 通知帶 prompt + 對接 AI Sidekick（接上優化 loop）
> 完整 scope（批次審查 agent / Quality evaluator / feedback memory / Anthropic vs LangChain 決策）見 **`docs/phase-3-sidekick-self-learning.md`**。

**目標**：真正把「問題 + 素材上下文 + 指令」一鍵送進 AI Sidekick。
- `advice` 升級為 **LLM 生成**（claude-sonnet-4-6），貼合該素材（看文案/數據），於偵測時呼叫。
- 新增 `actionPrompt`：預先組好、帶入該廣告 context（廣告名、目標、現況 CTR/CPC/頻次）的 prompt。
- `deepLink` 改為跳 **AI Sidekick 並預填** `actionPrompt`，使用者按一下即可生成優化後的文案/素材方向。
- 成本/延遲考量：LLM 只在「有異常 + 到排程」時呼叫，量可控；可加快取避免重複生成。
- **驗收**：點通知 →（A）跳 Sidekick 已預填 prompt；（B）Sidekick 產出可用的優化建議/新文案。
- **前置條件**：AI Sidekick 介面需支援「外部預填 prompt」的入口（query param 或 deep link state）。

### Phase 4 — 半自動 / 自動化廣告更新（獨立文件，最遠、風險最高）
**目標**：縮短人工步驟，朝「一鍵套用」逼近。串 Meta Marketing API 寫入素材。
- 完整 scope、Meta 寫入權限 / App Review 前置、人工審核關卡 → 見 **`docs/phase-4-ad-automation.md`**。
- 與 Phase 2/3 風險級別差一階（會真的動到別人花錢投放的廣告），故獨立評估，不在本文件承諾範圍內。

### 階段決策點
- **規則 vs LLM 建議**：Phase 2 先規則（快、便宜、驗證行為），Phase 3 再升級 LLM。先驗證「使用者會點進去優化」這個假設，再投資 LLM 成本。
- **是否進 Phase 3**：依 Phase 2 的通知點擊率/已讀率決定。沒人點 → 先優化通知本身（文案、觸達管道如 LINE），而非急著接 Sidekick。
