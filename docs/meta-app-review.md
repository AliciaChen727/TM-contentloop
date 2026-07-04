# Meta App Review 交付清單（ContentLoop 上線）

> 目標：通過 App Review，讓 App 從 Development mode 轉 Live，不再需要逐一邀請測試人員。
> 本輪範圍：**FB/IG 核心 8 權限**，移除 `pages_manage_posts`（見文末決策）。
> 日期基準：2026-07-04。

---

## 0. 送審前置（App 層級，缺一不可，否則直接退件）

- [ ] App 已切 **Live mode**（切換前確認下列都備妥）
- [ ] **隱私政策 URL**：`https://<正式網域>/privacy` ✅ 已有（build 產物含 `/privacy`）
- [ ] **資料刪除說明 URL**：`https://<正式網域>/data-deletion` ✅ 已有（含 `/data-deletion`）
- [ ] App 圖示、類別、用途說明填妥
- [ ] Business verification（若 Meta 要求；`business_management` 通常需要企業驗證）
- [ ] 準備一個 **reviewer 可登入的測試帳號**：Meta reviewer 不是你粉專的 admin，
      你要在送審表單提供「測試用 FB 帳號 + 密碼」或用 Test Users，且該帳號要能
      走完「登入 → 授權 → 看到資料」。這是最常卡關的點（見第 3 節）。

---

## 1. 送審權限清單（8 個，皆需 Advanced Access）

| # | 權限 | ContentLoop 用途（送審說明用） | Screencast 要拍到 |
|---|------|------|------|
| 1 | `pages_show_list` | 連接時列出使用者自己管理的粉專供選擇 | 授權後出現「選擇粉專」清單 |
| 2 | `pages_read_engagement` | 讀 FB 貼文互動（讚/留言/分享） | 內容儀表板 FB 貼文的互動數字 |
| 3 | `pages_read_user_content` | 讀 `/{page}/posts` 的 reactions/comments | 同上，貼文表格的互動欄 |
| 4 | `read_insights` | 讀 FB Page/貼文 Insights（觸及等） | 貼文觸及、Page 追蹤者折線圖 |
| 5 | `instagram_basic` | 讀連動 IG 帳號基本資料與貼文 | IG 貼文出現在儀表板 |
| 6 | `instagram_manage_insights` | 讀 IG 貼文/限動 Insights | IG 貼文/限動的觸及、觀看、略過率 |
| 7 | `ads_read` | 讀廣告成效供廣告儀表板 + 診斷引擎 | `/dashboard/ads` 的數據與 AI 診斷 |
| 8 | `business_management` | 抓掛在 Business Manager 底下的粉專 | 授權含 BM 的粉專也能連上 |

> `public_profile`（登入用）為預設權限，免送審。

---

## 2. 每個權限要交付的四件事（Meta 表單逐項要）

對**每一個**權限，送審表單都會要：

1. **用途文字說明**（上表第 3 欄可直接改寫）
2. **Step-by-step 重現步驟**（讓 reviewer 照做）
3. **Screencast 螢幕錄影**：完整「登入 → 授權該權限 → 資料顯示在畫面」，
   且畫面上要**看得到用該權限拿回來的實際資料**
4. **權限與功能的對應**（這個權限對應 App 哪個畫面/功能）

---

## 3. Screencast 腳本（一鏡到底，涵蓋全部 8 權限）

建議錄**一支完整流程** + 視情況補分鏡。腳本：

1. 打開 ContentLoop 首頁 → 點「登入 / 連接 Meta」
2. FB 登入 → **授權畫面出現 8 個權限**（停留 2 秒讓 reviewer 看清 scope）→ 允許
3. 回到 App → **出現「選擇粉專」清單**（→ `pages_show_list` / `business_management`）
4. 選一個粉專 → 進內容儀表板：
   - FB 貼文表格：互動數（→ `pages_read_engagement` / `pages_read_user_content`）
   - 貼文觸及 + 追蹤者折線圖（→ `read_insights`）
   - IG 貼文（→ `instagram_basic`）
   - 切「限動」分頁：IG 限動觀看/觸及/略過率（→ `instagram_manage_insights`）
5. 進 `/dashboard/ads` 廣告儀表板：廣告成效 + AI 診斷（→ `ads_read`）
6. 結束

錄影注意：
- [ ] 用 **reviewer 能登入的帳號**錄（不要用你自己 admin 私人帳號的敏感畫面）
- [ ] 全程英文介面（App 已有 en 切換，reviewer 多半英文審）→ 錄前切 English
- [ ] 授權畫面那格要清楚、可暫停
- [ ] 每個數字畫面停留足夠久

---

## 4. 移除 `pages_manage_posts` 的待辦

**決策理由**：實測 `GET /{pageId}/stories` 各粉專都讀得到 FB 限動並存進 Firestore，
但 **insights（觸及/觀看）恆為 0**（Meta 對 FB 限動的限制）。送審要「展示權限帶來
的價值」，一個只有縮圖、零數據的功能 reviewer 很可能判定「看不出用途」而退件；且它是
高風險的「管理/發文」類權限，會拖慢整批審查。移除**不影響** IG 限動（走
`instagram_manage_insights`）與貼文/廣告主功能。

- [ ] `apps/web/app/auth/(auth-group)/connect/page.tsx` 的 `SCOPES` 移除 `'pages_manage_posts'`
- [ ] 移除後果：新連接的使用者不再授予此權限 → FB 限動 sync（`syncFbStories`）拿到的
      是 page token，**大多數情況仍讀得到**（`/stories` 主要靠 page token，不一定需要此
      scope）；但保守起見預期 FB 限動同步可能回空。UI 已 graceful（顯示 IG 限動即可）。
- [ ] 保留 `lib/meta/fbStories.ts` 與 `cron/sync-stories` 程式碼不刪（未來若拿到數據可復用）
- [ ] connect 授權畫面文案 / 說明若列了「限動」用途，一併確認不誤導
- [ ] `apps/web/app/api/debug/scopes/route.ts` 的 EXPECTED 清單同步（該檔目前未列
      `pages_manage_posts`，確認一致即可）

> 若日後 Meta 開始提供 FB 限動 insights，再單獨補送 `pages_manage_posts`。

---

## 5. 送審後常見退件原因（自檢）

- [ ] Reviewer 登入卡在授權：確認測試帳號對某粉專有足夠角色能看到資料
- [ ] Screencast 沒拍到「資料實際顯示」：只錄授權不夠，要錄到數字
- [ ] `business_management` 未做企業驗證
- [ ] 隱私政策/資料刪除頁 404 或內容空泛
- [ ] 用途說明太籠統（要具體到「哪個畫面用哪個權限的哪個資料」）

---

## 附錄：本輪不送審的項目

- `pages_manage_posts` — 見第 4 節，本輪移除
- Threads（`threads_basic` / `threads_manage_insights`）— 獨立產品，日後單獨送
- Google/GA4 串接 — 屬 Google OAuth 審查，與 Meta 無關
