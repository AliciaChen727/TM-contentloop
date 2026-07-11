# Meta App Review 交付清單（ContentLoop 上線）

> 目標：通過 App Review，讓 App 從 Development mode 轉 Live，不再需要逐一邀請測試人員。
> 本輪範圍：**FB/IG 核心 8 權限**，移除 `pages_manage_posts`（見文末決策）。
> 日期基準：2026-07-04。
>
> ✅ **狀態：已於 2026-07-05 送出 App Review（app `832755139382467`）**，等 Meta 審查結果。
> 審查期間你仍是 app admin，開發模式下功能照常。若被退件，多半是測試帳號流程或
> Business Verification（`business_management`）——依退件說明補件後重送。
>
> 🆕 **第二輪（發文權限）已規劃，見第 7 節**——2026-07-12 外部帳號驗證確認 dev mode
> 期間 API 發到 FB 的所有內容僅 App role 可見，發文功能上線的唯一解法就是這輪審查。
>
> 📌 **App 對照（2026-07-12 確認）**：`832755139382467` = 實際串接 App（連粉專/token/
> 發文/送審都是它）；`858795133298101` = 只用在 FB 登入（Firebase Auth 的 Facebook
> 登入提供者），與 Graph API 功能和送審無關。

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

## 5. Development mode 下的 ContentLoop admin 與 Meta tester 差異

ContentLoop 內的 `owner` / `admin` / `editor` / `viewer` 是產品內權限；Meta Developer
的 app admin/developer/tester 是 **Development mode 下能否授權未審核 Meta scope** 的資格。
兩者不是同一件事。

### 同一粉專內的發文 token 共用

目前自動發文設計：

- **Facebook / Instagram 發文**：使用該 `pageId` 的 ContentLoop owner 存在
  `users/{ownerUid}/metaTokens/{pageId}` 的 Page access token。
- 因此，若 owner 已經在 Meta Development mode 下授權過 `pages_manage_posts` /
  `instagram_content_publish`，被該 owner 邀請進 ContentLoop 的 admin 可以透過 ContentLoop
  共用 owner token 發文。
- 這些被邀請的 ContentLoop admin **不需要另外加入 Meta Developer tester**，前提是他們只是
  使用 ContentLoop 既有 token 發文，而不是自己重新走 Meta OAuth 連接流程。

### 新粉專 / 新連接者的限制

若某位 owner 要連接其他粉專並取得新的 Page token：

- App 還在 **Development mode**，且發文 scope 尚未通過 App Review 時，該 Meta 使用者必須是
  這個 Meta App 的 admin/developer/tester，才能授權 `pages_manage_posts` /
  `instagram_content_publish` 等未審核或進階權限。
- 若該 Meta 使用者不是 app role/tester，即使他在 ContentLoop 被設為 admin，也不能在開發模式下
  正常授權這些發文 scope。
- 若 scope 是後來才新增的，既有 token 不會自動補權限；需要重新走「連接 Meta」OAuth，取得包含
  新 scope 的 token。
- 等 App 切 **Live mode** 且相關發文權限通過 App Review 後，才不需要逐一把新連接者加進
  Meta Developer tester。

### Threads 例外

Threads 使用獨立 OAuth 與 `graph.threads.net` token，不吃 FB/IG Page token。ContentLoop 發
Threads 時會找該 page 下已連過 Threads 的 admin token；至少要有一位 owner/admin 完成 Threads
授權且 token 仍有效。

---

## 6. 送審後常見退件原因（自檢）

- [ ] Reviewer 登入卡在授權：確認測試帳號對某粉專有足夠角色能看到資料
- [ ] Screencast 沒拍到「資料實際顯示」：只錄授權不夠，要錄到數字
- [ ] `business_management` 未做企業驗證
- [ ] 隱私政策/資料刪除頁 404 或內容空泛
- [ ] 用途說明太籠統（要具體到「哪個畫面用哪個權限的哪個資料」）

---

## 7. 第二輪送審：發文權限（2026-07-12 規劃）

**動機**：外部帳號逐篇驗證確認，Development mode 期間 API 發到 FB 的**所有內容**
（文字/圖片/影片/限動）只有 App role 看得到 —— ContentLoop 的 FB 發布在 go live 前
等於「預覽模式」。發文功能真正上線的唯一路徑就是把發文權限送過 App Review。

**送審 App**：`832755139382467`（同第一輪）。

### 7.0 目前狀態（2026-07-12 console 實查）＋下一步

**現況**：第一輪唯讀權限批次「等待應用程式審查」中（`pages_read_engagement`、
`pages_read_user_content` 等顯示該狀態）。**發文權限尚未送審**——`pages_manage_posts`
狀態是「可供測試」（Standard Access，開發模式測試用），其「新增到應用程式審查」
按鈕被鎖住，console 提示「此要求已在等待審查中…或先等目前的這項要求完成」＝
**第一輪批次審完之前，不能把新權限加進審查**。`instagram_content_publish` 同理。

**第一輪等待期間的待辦（現在就能做）**：

1. [ ] **準備 reviewer 測試帳號**：能登入 ContentLoop、是測試粉專 admin、粉專連動
       IG 商業帳號、能走完「建草稿→核准→發布」。
2. [ ] **預錄第二輪 screencast**：腳本見 7.2；英文介面、拍到授權畫面與發布後 FB/IG
       實際出現貼文。
3. [ ] 等待期間**不要密集測試發文**（dev mode 貼文外部本來就看不到，密集發文+刪除
       只會製造混亂）；正式對外 FB 貼文一律用 Meta Business Suite 手動發。

**第一輪結果出來後的行動**：

- **通過** → 立刻發起第二輪：把 `pages_manage_posts` + `instagram_content_publish`
  「新增到應用程式審查」（此時按鈕解鎖），附 7.1 用途說明 + 7.2 screencast。
- **退件** → 看退件理由對照第 6 節自檢清單補件（最常見：screencast 沒拍到實際資料、
  測試帳號走不完流程、`business_management` 缺企業驗證）→ 修正後重送，第二輪順延。

**第二輪通過後**：App 切 Live mode → Vercel 設 `NEXT_PUBLIC_META_APP_LIVE=1` 重新部署
→ **用非 App role 帳號**驗證 FB 貼文/影片/限動外部可見（驗收鐵則：App Admin 自己看到
不算數）→ 預覽模式警告與封面截圖 fallback 自動退場。

### 7.1 權限清單（2 個）

| # | 權限 | ContentLoop 用途（送審說明用） | Screencast 要拍到 |
|---|------|------|------|
| 1 | `pages_manage_posts` | 使用者在 ContentLoop 撰寫/核准 AI 草稿後，發布貼文到自己管理的 FB 粉專（含排程發布） | 草稿核准 → 一鍵發布 → FB 粉專出現該貼文 |
| 2 | `instagram_content_publish` | 同一草稿同步發布到連動的 IG 商業帳號（貼文/Reels/限動） | 同一次發布 → IG 帳號出現貼文與限動 |

### 7.2 Screencast 腳本（發文流程一鏡到底）

1. 登入 ContentLoop（用 reviewer 可登入的測試帳號）→ 進「內容草稿」
2. 建立草稿：選 FB+IG → 上傳圖片 → 輸入文案（或按 AI 生成）
3. 按「核准」→ 按「一鍵發布」→ 畫面顯示逐平台發布中/成功
4. 開新分頁：FB 粉專顯示剛發布的貼文（→ `pages_manage_posts`）
5. 開 IG：帳號出現同一篇貼文（→ `instagram_content_publish`）
6. （加分）回 ContentLoop 展示排程發布設定畫面，說明 cron 也走同一 API

### 7.3 注意事項

- **HITL 是加分項**：送審說明要強調「所有發布都需使用者手動核准後觸發，絕不自動亂發」
  ——Meta 對發文類權限最在意濫用，我們的草稿→核准→發布流程正好是防濫用設計。
- **測試帳號要能走完發布**：reviewer 的測試帳號需要是某個測試粉專的 admin 且該粉專
  連動了 IG 商業帳號，否則 reviewer 無法重現流程（最容易卡關的點）。
- **IG 一起送、Threads 不用**：`instagram_content_publish` 與 `pages_manage_posts`
  同 App 同輪送；Threads 走獨立 OAuth（`graph.threads.net`），不在 Meta App Review
  範圍，且 `threads_content_publish` 開發模式即可用、目前運作正常。
- 通過後：Vercel 設 `NEXT_PUBLIC_META_APP_LIVE=1` → FB Story／FB 完整影片（含音樂）
  一次恢復、預覽模式警告與封面截圖 fallback 自動退場（見 `lib/content/fbStoryFlag.ts`）。
- 第 4 節「移除 pages_manage_posts」是第一輪的歷史決策；S4b 之後 `SCOPES` 已加回
  `pages_manage_posts` + `instagram_content_publish`（開發模式供 admin 授權用），
  與本輪送審一致。

---

## 附錄：本輪不送審的項目

- `pages_manage_posts` — 見第 4 節，第一輪移除；**第二輪送審（見第 7 節）**
- Threads（`threads_basic` / `threads_manage_insights`）— 獨立產品，日後單獨送
- Google/GA4 串接 — 屬 Google OAuth 審查，與 Meta 無關
