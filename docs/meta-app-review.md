# Meta App Review 交付清單（ContentLoop 上線）

> 目標：通過 App Review，讓 App 從 Development mode 轉 Live，不再需要逐一邀請測試人員。
> 本輪範圍：**FB/IG 核心 8 權限**，移除 `pages_manage_posts`（見文末決策）。
> 日期基準：2026-07-04。
>
> ❌ **狀態：第一輪 8 權限已於 2026-07-20 前後整批退件**（Developer Policy 1.6「使用
> 案例無效」通用模板）。**退件分析與重送計畫見第 8 節**（單一事實來源，取代第 7.0 節
> 的舊狀態）。重送組合已拍板（2026-07-20 二修）：**原 8 唯讀全保留（含
> `business_management`，使用者決策：無法預知連接者粉專是否 BM-only）+ `pages_manage_posts`
> 共 9 個**，`instagram_content_publish` 留下一輪；Threads 平行走獨立送審（見第 9 節）。
>
> 🆕 第二輪（發文權限）原規劃見第 7 節——2026-07-12 外部帳號驗證確認 dev mode
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

> ⚠️ **2026-07-20 更新：本節已過時。** 第一輪已整批退件，「按鈕鎖住」的前提不存在了
> （批次結案後可重新編輯送審內容）。最新狀態與重送計畫以**第 8 節**為準；本節保留
> 作為歷史紀錄。7.1/7.2/7.3 的發文權限說明與腳本仍有效，已併入第 8 節的重送包。

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

## 8. 第一輪退件分析＋重送計畫（2026-07-20，單一事實來源）

### 8.1 退件事實

- 2026-07-04 送出的 8 個權限**整批被拒**：`pages_read_user_content`、`pages_show_list`、
  `business_management`、`read_insights`、`ads_read`、`pages_read_engagement`、
  `instagram_manage_insights`、`instagram_basic`。
- 退件理由：**Developer Policy 1.6「開發值得信賴的產品」通用模板**——「使用案例無效，
  或並非支援核心功能所需」。無逐權限具體說明。
- 送審內容存檔：`ContentLoop_Meta_App_Review_Submitted_On_2026-07-04.pdf`（使用者 Downloads）。

### 8.2 退件原因分析（依嚴重度）

1. **審查機制認知錯誤（主因）**：Meta 審查員**用自己的內部測試帳號**測 app，不會用
   我們提供的帳密；且他們**以 screencast 為主要依據**，影片沒演示到位就直接退，根本
   不會登入。我們給的 Google 測試帳號（contentloop.review@gmail.com）「沒被用過」
   是正常現象——戰場在影片，不在測試帳號。**不需要、也不用提供任何 FB 帳密。**
2. **`ads_read` 用途說明是複製貼上錯誤**：送審表單裡 `ads_read` 的說明整段寫的是
   `read_insights` 的內容（Page Insights / follower counts），審查員看到「申請的權限
   與描述的功能對不上」→ 正中 1.6。重送必須改寫（見 8.4）。
3. **`business_management` 高風險**：官方允許用途是「管理商家資產／認領廣告帳號」，
   我們只是列 BM 名下粉專，容易被判「`pages_show_list` 就夠了」；且此權限實務上
   需要企業驗證（未做）。一個權限被判不必要，常拖累整批。
4. **Screencast 品質疑慮**：中文 UI 無英文註解、未必逐權限標註。參考成功案例
   （PostMoore，收到一字不差的 1.6 模板退件後改四件事即過審）：
   放慢錄影、登入→OAuth 同意→功能全流程、**每個權限用到的當下加英文註解標明權限名**、
   只送實際在用的權限。

### 8.3 重送組合（2026-07-20 使用者拍板；同日二修：保留 business_management）

**App `832755139382467` 重送一批 9 個**：

| 動作 | 權限 |
|---|---|
| ✅ 保留重送（8） | `pages_show_list`、`pages_read_engagement`、`pages_read_user_content`、`read_insights`、`instagram_basic`、`instagram_manage_insights`、`ads_read`、`business_management` |
| ➕ 本輪新增（1） | `pages_manage_posts`（發布功能已完成可演示；HITL 核准是賣點） |
| ➖ 留下一輪 | `instagram_content_publish` |

**保留 `business_management` 的理由（使用者決策）**：ContentLoop 是給多個粉專 Admin 用的
（user-centric 架構），無法預知未來連接者的粉專是否只掛在 Business Manager 底下；沒有此
權限，BM-only 粉專在 OAuth 時抓不到（`/me/businesses` 不可用）→ 該使用者完全連不進來。

**保留的代價與配套（必做，否則此權限大概率再退）**：

1. **企業驗證（Business Verification）是硬前置**——此權限實務上幾乎必查。在
   Meta Business Suite 安全中心完成商家驗證（需商家/組織證明文件）。若短期無法完成，
   要有心理準備：此權限單獨再退、其餘 8 個仍可逐權限過（Meta 是逐權限判定），屆時再拔。
2. **用途說明升級**（見 8.4）：明確對應退件通知要求的三件事，並強調它是「粉專探索
   （page discovery）」的必要條件而非管理商家資產。
3. **screencast 加一幕**（見 8.5 第 3b 幕）：展示一個「只掛在 Business Manager 底下」
   的粉專出現在選擇清單——建議先建一個免費 BM、把測試粉專移進去，才有畫面可拍。

### 8.4 各權限英文用途說明（重送表單直接貼）

每則都含 Meta 退件通知點名的三件事：哪個功能需要它／如何提升 app 功能／如何提升使用者體驗。

**pages_show_list**
> ContentLoop is an analytics and content dashboard for Facebook Page admins. Feature: the "Connect Meta" flow and the Page selector. We call GET /me/accounts to list only the Pages the authenticated user manages, so they can (1) choose which of their own Pages to view, and (2) we verify Page ownership before showing any data (access control). This improves the app by scoping every dashboard to a Page the user actually manages, and improves the user experience by letting multi-Page admins switch between their own Pages safely. Read-only; the list is shown only to the user who manages those Pages.

**pages_read_engagement**
> Feature: the "Content" dashboard post table. We call GET /{page-id}/posts to read the admin's own Page posts and Page metadata. This lets the dashboard show each post the admin published, which improves the app by giving admins one place to review their own content, and improves their experience by removing the need to check each post manually in Facebook. We do not post, modify, or manage any content; data is shown only to the authenticated admin of that Page.

**pages_read_user_content**
> Feature: the engagement columns (reactions, comments, shares) in the "Content" dashboard. We read reactions.summary(total_count), comments.summary(total_count), and shares on the admin's own Page posts via GET /{page-id}/posts. This improves the app by computing per-post engagement metrics, and improves the admin's experience by showing at a glance which of their posts resonate with their audience. We never create, edit, delete, hide, or reply to any post or comment; counts are displayed only to the authenticated Page admin.

**read_insights**
> Feature: the reach figures and follower-growth chart in the "Content" dashboard. We call GET /{page-id}/insights and GET /{post-id}/insights to read reach/views and follower counts for the admin's own Page. This improves the app by adding performance trends on top of raw post lists, and improves the admin's experience by letting them track growth over time without exporting data from Meta Business Suite. Read-only analytics, shown only to the Page admin.

**instagram_basic**
> Feature: the Instagram section of the "Content" dashboard. We read the Instagram Business account connected to the admin's Facebook Page — profile and media list — via the Instagram Graph API. This improves the app by showing Facebook and Instagram content side by side, and improves the admin's experience by giving one combined view instead of two separate tools. Read-only; shown only to the authenticated admin who manages the linked account.

**instagram_manage_insights**
> Feature: the Instagram post metrics and the "Stories" tab. We call GET /{ig-media-id}/insights to read reach, views, and Story metrics (views, exits) for the connected Instagram Business account's posts and Stories. This improves the app by quantifying how each IG post and Story performed, and improves the admin's experience because Story metrics disappear after 24 hours on Instagram itself — ContentLoop preserves them for later review. Read-only; shown only to the admin.

**ads_read**
> Feature: the "Ads" dashboard (/dashboard/ads). We call GET /me/adaccounts to find the admin's own ad accounts and GET /act_{ad-account-id}/insights to read ad performance — impressions, clicks, CTR, spend, CPA — for ads promoting the admin's own Page. This improves the app by powering the ad performance tables and an automated rule-based diagnosis that flags underperforming ads, and improves the admin's experience by explaining ad results in plain language. Strictly read-only: we never create, modify, or manage ads. Data is shown only to the authenticated admin.

**business_management**
> Feature: the "Connect Meta" Page-discovery step. Many Page admins manage their Pages exclusively through Meta Business Manager, with no direct personal role on the Page — for those users GET /me/accounts returns nothing. We call GET /me/businesses and the business's owned/client Pages solely to discover which Pages the authenticated user manages through Business Manager, so those Pages appear in the Page selector and can be connected. This improves the app because without it, admins of Business-Manager-owned Pages cannot use ContentLoop at all, and improves the user experience by making onboarding work the same way regardless of how the user's organization structures Page ownership. We only read the list of Pages for discovery and access control; we never create, modify, or claim any business asset or ad account.

**pages_manage_posts**
> Feature: the "Content Drafts" publishing flow. The admin composes or AI-generates a draft in ContentLoop, then must manually approve it; only after explicit human approval does ContentLoop publish the post to the admin's own Facebook Page via POST /{page-id}/feed (or /photos), optionally at a scheduled time. This improves the app by completing the loop from analytics to content creation to publishing, and improves the admin's experience by letting them prepare, approve, and schedule Page posts in one place. Safeguards: every publish requires a manual human approval step — the app never posts autonomously; drafts are locked after publishing. Posts go only to Pages the authenticated admin manages.

### 8.5 Screencast 重錄分鏡（一鏡到底，逐幕英文註解）

錄影規格：**英文 UI**（錄前切 English）、1080p 以上、游標可見、不加音訊、放慢操作、
每一幕疊上英文文字註解（下表 Caption 欄），從**登出狀態**開始。

| 幕 | 畫面 | 疊字註解（英文） |
|---|---|---|
| 1 | ContentLoop 首頁（未登入）→ 點 Login | "ContentLoop — analytics & content dashboard for Page admins. Logging in…" |
| 2 | Facebook 登入 → OAuth 同意畫面**停留 3 秒**，9 權限清楚入鏡 → 允許 | "Meta OAuth consent — the app requests only the 9 scopes in this submission. User grants access." |
| 3 | 回 App 出現「選擇粉專」清單 | "pages_show_list — listing only the Pages this user manages, for selection & access control" |
| 3b | 清單中指出一個**只掛在 Business Manager 底下**的粉專（先建免費 BM＋移入測試粉專） | "business_management — this Page is owned by a Business Manager (no direct personal role); it is discoverable only via /me/businesses" |
| 4 | 內容儀表板：FB 貼文表格與互動數 | "pages_read_engagement + pages_read_user_content — the admin's own posts with reactions/comments/shares counts" |
| 5 | 觸及數字＋追蹤者折線圖 | "read_insights — post reach and follower growth for the admin's own Page" |
| 6 | IG 貼文區塊 | "instagram_basic — media from the connected Instagram Business account" |
| 7 | 限動分頁：觀看/觸及/略過率 | "instagram_manage_insights — Story views/reach; preserved after the 24h expiry" |
| 8 | `/dashboard/ads`：成效表格＋AI 診斷卡 | "ads_read — the admin's own ad account insights power this dashboard and the automated diagnosis" |
| 9 | 內容草稿：建立草稿 → 按「核准」 | "Content draft — requires explicit HUMAN APPROVAL before anything can be published" |
| 10 | 按「發布」→ 顯示發布成功 | "pages_manage_posts — publishing the approved draft to the admin's own Page" |
| 11 | 開新分頁：FB 粉專上出現該貼文 | "The approved post is now live on the admin's own Facebook Page" |
| 12 | （加分）排程發布設定畫面 | "Scheduled publishing uses the same API, still only for human-approved drafts" |

### 8.6 重送前 checklist

- [ ] 表單 9 則用途說明換成 8.4 版本（特別確認 `ads_read` 不再是 read_insights 內容）
- [ ] console 確認清單＝9 個（含 `business_management`；`instagram_content_publish` 不在）
- [ ] **企業驗證（Business Verification）**：Business Suite 安全中心完成商家驗證
      （`business_management` 的硬前置，見 8.3）
- [ ] 建免費 Business Manager＋移入測試粉專（8.5 第 3b 幕的演示素材）
- [ ] Screencast 依 8.5 重錄，**每個權限都有自己的一幕**，一個都不能漏
- [ ] 隱私政策 `/privacy`、資料刪除 `/data-deletion`：秒開、含聯絡方式、涵蓋這 9 權限的資料使用
- [ ] Reviewer 說明（platform settings）：保留 Google 測試帳號＋步驟，但明講
      "Reviewers may also test with their own test account via Facebook Login"
- [ ] `SCOPES`（`connect/page.tsx`）與送審清單一致（`business_management` 保留，**不拔**）
- [ ] 送出後記錄日期；2026 年審查週期最長約 20 天

---

## 9. Threads 獨立送審（2026-07-20 啟動，與第 8 節平行）

Threads 走獨立 OAuth（`threads.net/oauth/authorize` + `graph.threads.net`），審查軌道
與 app 832 完全分開，**互不拖累**。現況：tester（開發模式）下讀取＋發文皆正常；
送審目的＝開放**非 tester 一般使用者**自助連接 Threads。

### 9.1 權限清單

| 權限 | 用途 | Screencast 要拍到 |
|---|---|---|
| `threads_basic` | 連接 Threads 帳號、讀貼文清單（內容表現頁） | OAuth → Threads 貼文出現在儀表板 |
| `threads_content_publish` | 核准後的草稿發布到 Threads（同 HITL 流程） | 草稿核准 → 發布 → Threads 出現貼文 |
| `threads_manage_insights` | Threads 貼文瀏覽/互動數據＋追蹤者快照 | 儀表板 Threads 數據區塊 |

> `threads_manage_replies`（發布後自動附留言）：若重錄時留言功能會入鏡就一併送，
> 否則先拔——只送影片有演示的權限。

### 9.2 注意事項

- 用途說明與註解手法完全比照 8.4/8.5（三段式英文說明＋逐幕權限註解）。
- Threads 的 HITL 說法同樣是賣點：發布一律經人工核准。
- 送審入口在 Meta console 的 Threads use case（與 FB/IG 權限不同區）。

---

## 附錄：本輪不送審的項目

- `instagram_content_publish` — IG 發文，**下一輪**（`pages_manage_posts` 過審後補送，見 8.3）
- Google/GA4 串接 — 屬 Google OAuth 審查，與 Meta 無關
