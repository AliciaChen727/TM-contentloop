# App Review Screencast 拍攝腳本（2026-07-20 重送用）

> 對象：App `832755139382467` 第二次送審的 **12 個權限**（決定一次全送，不修剪 SCOPES）。
> 搭配 `docs/meta-app-review.md` 第 8 節（退件分析 + 用途說明）一起用。
> 目標：一支一鏡到底的影片，**每個送審權限都有自己的一幕**（漏一個 = 該權限必退）。

## 本次涵蓋的 12 個權限

| # | 權限 | 在影片哪一幕證明 | 風險 |
|---|------|------|------|
| 1 | `pages_show_list` | 幕 3：授權後出現「選擇粉專」清單 | 低 |
| 2 | `business_management` | 幕 2 同意畫面 + 幕 3 旁白（⚠️ 無 BM-only 粉專佐證） | 中 |
| 3 | `pages_read_engagement` | 幕 4：FB 貼文表格 | 低 |
| 4 | `pages_read_user_content` | 幕 4：貼文的讚/留言/分享數字 | 低 |
| 5 | `read_insights` | 幕 5：觸及數字 + 追蹤者折線圖 | 低 |
| 6 | `instagram_basic` | 幕 6：IG 貼文 | 低 |
| 7 | `instagram_manage_insights` | 幕 7：IG 貼文洞察 + 限動數據 | 低 |
| 8 | `ads_read` | 幕 8：廣告儀表板 + AI 診斷 | 低 |
| 9 | `instagram_manage_messages` | 幕 9：私訊分析頁 | 🔴 高（唯讀用途 Meta 常質疑） |
| 10 | `pages_messaging` | 幕 9：私訊分析頁 | 🔴 高（同上） |
| 11 | `pages_manage_posts` | 幕 10–12：草稿 → 核准 → 發布 FB → FB 粉專出現貼文 | 中 |
| 12 | `instagram_content_publish` | 幕 10–12：同一次發布到 IG → IG 帳號出現貼文 | 中 |

> Meta 逐權限判定：即使 9/10（私訊）或 2（BM）被退，其餘照樣能過。

---

## 🚨 錄影前置（缺一不可）

1. **UI 切英文**：右上語言切 English（審查多為英文審）。錄前確認整個流程都是英文。
2. **測試帳號**：用 reviewer 也能登入的測試帳號（非你私人 admin 帳號的敏感畫面）。
   該帳號需是某測試粉專 admin、粉專連動 IG 商業帳號，且**該粉專有實際數據**
   （貼文、廣告、限動、**私訊對話**都要有內容——空畫面等於沒證明權限）。
   ⚠️ 私訊統計要有數字，測試粉專/IG 需要有幾則真實對話紀錄。
3. **先準備草稿素材**：幕 10 要現場核准並**同時發 FB + IG**，先想好文案 + 一張圖。
4. **企業驗證**：私訊兩權限 + `business_management` 幾乎必須先完成 Business Verification，
   建議送審前先在 Business Suite 安全中心辦好（否則這 3 個大概率退）。
5. **錄影規格**：1080p 以上、游標可見、**不收音**（用畫面疊字）、操作放慢、
   數字畫面停留 2–3 秒。
6. **不需改 code**：SCOPES 現有 12 個 = 送審 12 個，同意畫面與清單一致，保持原樣。

---

## 分鏡腳本（一鏡到底）

> 每一幕的「疊字」= 直接打在畫面上的英文註解。讓審查員不用猜：這一刻用哪個權限、做什麼。

### 幕 1 — 開場（未登入）
- **操作**：開 ContentLoop 首頁（登出狀態）→ 停 2 秒 → 點「Login / Connect Meta」
- **疊字**：`ContentLoop — an analytics & content dashboard for Facebook Page admins.`

### 幕 2 — Facebook 登入 + 授權同意畫面（最關鍵）
- **操作**：走 Facebook 登入 → 出現 OAuth 同意畫面 → **停留 4 秒讓 12 個權限清楚入鏡**
  → 按「允許 / Continue」
- **疊字**：`Meta OAuth consent — the app requests the scopes in this submission. The user grants access.`
- **注意**：這一格要能暫停看清 scope 清單。

### 幕 3 — 選擇粉專清單
- **操作**：回到 App → 出現「選擇粉專」清單 → 游標移過清單 → 選一個粉專
- **疊字**：`pages_show_list — listing only the Pages this user manages, so they can pick one; also used to verify Page ownership before showing any data.`
- **business_management 第二行疊字（停 2 秒）**：
  `business_management — also used to discover Pages the user manages through Meta Business Manager, so those Pages appear here too.`

### 幕 4 — 內容儀表板：FB 貼文與互動
- **操作**：進儀表板 → 切到 **FB** 分頁 → 展示貼文表格，游標移過「讚/留言/分享」欄
- **疊字**：`pages_read_engagement + pages_read_user_content — the admin's own FB posts with their reactions, comments, and shares counts.`

### 幕 5 — 觸及與追蹤者成長
- **操作**：展示「觸及/reach」數字 → 捲到**追蹤者折線圖**停 3 秒
- **疊字**：`read_insights — post reach and the Page's follower-growth chart over time.`

### 幕 6 — IG 貼文
- **操作**：切到 **IG** 分頁 → 展示 IG 貼文清單
- **疊字**：`instagram_basic — media from the connected Instagram Business account, shown next to the Facebook data.`

### 幕 7 — IG 貼文洞察 + 限動
- **操作**：游標移過 IG 貼文觸及/觀看數字 → 上方類型篩選點「Stories/限動」→ 展示限動數據
- **疊字**：`instagram_manage_insights — reach/views for IG posts, and Story metrics (views, reach, exits) preserved after the 24-hour expiry.`

### 幕 8 — 廣告儀表板 + AI 診斷
- **操作**：進 `/dashboard/ads` → 展示成效表格（曝光/點擊/花費/CTR/CPA）→ 捲到 **AI 診斷卡**停 3 秒
- **疊字**：`ads_read — the admin's own ad-account insights power this dashboard and the automated, rule-based diagnosis. Strictly read-only.`

### 幕 9 — 私訊分析（唯讀）🔴 高風險，說明要精準
- **操作**：進 `/dashboard/messages`（標題 **Messages**）→ 展示統計（每日則數、發問人數等）
  → 游標停在數字上停 3 秒
- **疊字**：`instagram_manage_messages + pages_messaging — READ-ONLY. We only aggregate message counts (e.g. daily volume) for analytics. We never read message content shown to third parties, and never send, reply to, or manage any conversation.`
- **注意**：Meta 對私訊權限最敏感。旁白/疊字**務必**強調「唯讀、只算則數、絕不傳訊/回覆」，
  與送審用途說明（見 8.4 補充）字句一致。

### 幕 10 — 建草稿 + 人工核准（HITL）
- **操作**：進 `/dashboard/content-drafts` → 建草稿：**同時選 FB + IG** → 上傳圖 → 輸入文案
  （或按 AI 生成）→ 按「核准 / Approve」
- **疊字**：`Content draft — every post requires an explicit HUMAN APPROVAL step. The app never publishes on its own.`

### 幕 11 — 發布到 FB + IG
- **操作**：按「發布 / Publish」→ 畫面顯示逐平台發布中 → FB 成功、IG 成功
- **疊字**：`pages_manage_posts + instagram_content_publish — publishing the approved draft to the admin's own Facebook Page AND connected Instagram Business account.`

### 幕 12 — 驗證貼文出現在 FB 與 IG
- **操作**：開新分頁 → FB 粉專出現剛發的貼文 → 再開 IG → 帳號出現同一篇貼文
- **疊字**：`The approved post is now live on both the Facebook Page and the Instagram account.`

### 幕 13 —（加分）排程說明
- **操作**：回 content-drafts → 展示「排程/Schedule」設定畫面
- **疊字**：`Scheduled publishing uses the same API and still only publishes human-approved drafts.`

---

## ⚠️ 風險註記

### business_management（中）
不建 BM-only 測試粉專 → 影片沒有專屬佐證畫面。緩解：幕 2/3 疊字 + 8.4 用途說明講清「粉專探索」。

### 私訊兩權限（高）
`instagram_manage_messages` / `pages_messaging` 官方用途是「管理對話」，唯讀統計是非典型用途，
Meta 可能判「非該權限允許用途」。緩解：疊字 + 用途說明極力強調唯讀 + 只算則數 + 絕不傳訊。
最壞情況這兩個單獨被退，不影響其餘 10 個（逐權限判定）。**建議送審前完成企業驗證。**

---

## 錄影後 checklist

- [ ] 12 個送審權限都在影片出現過（對照最上方表格，一個都不漏）
- [ ] 同意畫面 scope 清單完整入鏡、可暫停看清
- [ ] 私訊那幕的疊字精準（唯讀、只算則數、絕不傳訊/回覆）
- [ ] 全程英文 UI、疊字清楚、數字畫面停留足夠久
- [ ] 幕 12 真的拍到 FB **和** IG 都出現貼文（不是只在 App 內顯示成功）
- [ ] 影片上傳送審表單，用途說明貼 `meta-app-review.md` 8.4 版本（含新增的 3 則）
