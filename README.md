# ContentLoop

> Toastmasters 分會用的 **AI 廣告／內容成效儀表板**。從 FB 粉專 + 連動 IG 抓貼文／廣告／限動成效，存進 Firestore，用 Next.js 儀表板呈現，並提供 AI 診斷、洞察報告、AI Sidekick 與廣告異常通知。

線上版本：<https://tm-contentloop.vercel.app/> · 登入：<https://tm-contentloop.vercel.app/auth/login>

---

## ⚠️ 維護規範（最重要，先讀這段）

> **每一次「重大程式改動」或「memory 更新」，都必須回頭更新這份 README。**

- **重大程式改動** = 新功能、改架構、改診斷規則、加／改 API、加外部整合、改部署方式。小修字、改 typo 不必。
- **memory 更新** = 新增或修改 `~/.claude/.../memory/` 下的任何檔（含 `MEMORY.md`）。
- 更新方式：改對應章節 **＋** 在文末 [變更紀錄](#變更紀錄) 補一行（日期 + 一句話 + commit）。
- 這條規範同時記在 `CLAUDE.md`，每個 session 都會被提醒遵守。

---

## 專案現況

| Phase | 內容 | 狀態 | 文件 |
|-------|------|------|------|
| 1 | Meta OAuth + 定時抓 FB/IG 成效 + 儀表板 | ✅ 已上線 | — |
| 2 | 站內通知中心（紅點）+ 排程 email 告警 | ✅ 已上線 | `docs/phase-2-notification-center.md` |
| 3 | AI Sidekick 優化 loop + 自我學習（評審 / 品質分 / feedback memory，Anthropic 原生 agent） | 🔄 進行中 | `docs/phase-3-sidekick-self-learning.md` |
| 4 | 半自動廣告更新（Meta Marketing API 寫入，需 App Review） | 📋 規劃中 | `docs/phase-4-ad-automation.md` |

延伸整合：**Threads**（內容成效，獨立 OAuth）、**GA4**（電商客戶用 Google Ads 的補充數據）— 皆 PoC／骨架階段，見 `docs/`。

---

## 技術棧

| 層 | 技術 |
|---|---|
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| 後端 (BFF) | Next.js API Routes（與前端同一包）|
| 排程後端 | Firebase Cloud Functions (Node.js 20) |
| 資料庫 | Firestore |
| 身份驗證 | Firebase Auth + Meta OAuth 2.0 |
| 外部 API | Meta Graph API、Claude、Gemini、fal.ai、Canva、Threads、GA4 Data API、Gmail SMTP |
| 部署 | Vercel（前端 + API）+ Firebase（Functions） |

**使用的 Model**：`claude-sonnet-4-6`（Sidekick 對話、洞察報告）、`claude-haiku-4-5`（素材生成）、`gemini-2.5-flash`（品質評審 judge）、`gemini-embedding-001`（few-shot 檢索）。診斷引擎本身 = 規則，無 model。圖片／影片走 owner GCP Vertex AI service account。

---

## 架構（重要心智模型）

這**不是**傳統前後端分離，而是 **Next.js 全端單體 + BFF**：

```
瀏覽器 (React UI)
   │  只打自家 API，從不直接讀 Firestore
   ▼
/api/*  (69 支 BFF route，跑在 Vercel)
   │  verifyIdToken + Firebase Admin SDK
   ├─► Firestore（資料）
   ├─► Meta / Claude / Gemini / fal.ai / Canva / Threads / GA4（外部）
   └─► （排程）Firebase Functions：每日抓 FB/IG 成效
```

- **前端 UI 與 API routes 同一個 codebase、一起 build、一起部署到 Vercel** → 沒分離。
- **Firebase Functions 是唯一真正獨立的後端**（定時 cron）。
- 詳見 `docs/architecture.md`。

### 鐵則：client 絕不直接讀 Firestore
security rules 會擋 → 直接登入失敗。所有資料存取一律走 `/api/*` BFF。詳見 memory `project_client_firestore_login`。

---

## 目錄結構

```
TM-contentloop/
├─ apps/web/                  # Next.js（前端 + BFF API）← 主要程式
│   ├─ app/                   # App Router 頁面
│   │   ├─ page.tsx           # 行銷首頁（登入入口）
│   │   ├─ auth/              # 登入 / 連接 Meta / callback
│   │   ├─ dashboard/         # 儀表板（ads / settings / members…）
│   │   └─ api/               # 69 支 BFF route（cron / ads / insights / ai / auth…）
│   ├─ components/            # React 元件（ads/ analytics/ …）
│   ├─ lib/                   # 純邏輯（ads/diagnosis、sidekick/、meta/、ai/…）
│   └─ next.config.mjs        # 含 /__/auth/* rewrite（Auth 同源修正）
├─ functions/                 # Firebase Cloud Functions（FB/IG 定時抓取）
├─ docs/                      # 規劃文件（單一事實來源）
├─ CLAUDE.md                  # 專案世界觀 + AI 協作規則
└─ README.md                  # ← 本檔
```

---

## 主要功能

- **FB + IG 成效儀表板** — Meta 授權後定時同步貼文 / 廣告 / 限動，page-scoped 儲存。
- **AI 診斷引擎** — 依廣告目標比對指標門檻，標出問題並給可執行建議。**規則只有一份**：`apps/web/lib/ads/diagnosis.ts`（改門檻只動這檔，三個消費端同步生效）。
- **AI Sidekick** — 帶當下數據的對話助理，可生成文案／圖片；自我學習迴圈（行為感知 evaluator + few-shot 反哺）。
- **自動洞察報告** — 含同業 benchmark、最佳貼文、廣告 A/B、下一步建議；Firestore 快取 + fingerprint 自動失效。
- **站內通知 + email 告警** — per-user 通知（紅點）+ 排程告警，只有 critical/warning 發送。
- **素材生成 × 品牌素材庫** — AI 生圖；上傳 logo 可在生圖時 sharp 像素級疊上，或一鍵帶進 Canva。

---

## 開發指令（monorepo，程式在 `apps/web`）

```bash
cd apps/web
npm run dev          # 本機開發
npx tsc --noEmit     # 型別檢查
npx eslint <files>   # lint
npm run build        # production build
```

**紀律**：每次改完 → `tsc` + `eslint` + `next build` **三關全綠**才 commit。

**部署流程（2026-06-07 起）**：
1. 改完 → 三關全綠
2. **先 `npm run dev` 跑 localhost（http://localhost:3000）給使用者測**
3. 使用者確認「OK」**才** `git commit` + `git push`（main → Vercel 自動部署前端 + API）
4. `functions/` 變更 → `firebase deploy`

> ⚠️ 未經使用者在 localhost 測試確認前，不要逕自 push。純文件（README/docs/memory）類改動可豁免 localhost 步驟。

---

## 環境與密鑰

- Firebase 專案：`contentloop-dev`（Blaze plan）
- Meta App：Business 類型，Development mode
- 所有 secret／token 只存 `.env.local`（前端）或 Firebase Secret Manager / Vercel env（後端）—— **絕不 commit**。

---

## 多粉專資料隔離（release 前必過的關卡）

使用者可能同時是多個粉專的 Admin。**只要請求帶了 `pageId`，所有讀取貼文／洞察／廣告的程式碼都必須以該 `pageId` 為界**，對 viewer / admin / owner / super-admin 一律適用。

- FB legacy collection 必加 `` `${pageId}_` `` 前綴過濾；IG legacy 有 pageId 時完全不讀。
- 驗收：用「同時管理 A、B 兩粉專的 admin」登入，切到 A 不可看到任何 B 的資料。
- 細節見 `CLAUDE.md` 與 memory `feedback_page_isolation`。

---

## 相關文件

- `CLAUDE.md` — 專案世界觀、AI 協作規則、診斷引擎單一事實來源、隔離鐵則。
- `docs/architecture.md` — 系統架構。
- `docs/goal-metrics.md` — 廣告目標 → 指標對照。
- `docs/phase-*.md` — 各階段規劃。
- AI 記憶索引：`~/.claude/projects/-Users-pei-wenchen-Files-TM-contentloop/memory/MEMORY.md`

---

## 變更紀錄

> 規範：重大程式改動 / memory 更新時，在此補一行（日期 + 摘要 + commit）。最新在上。

| 日期 | 變更 | Commit |
|------|------|--------|
| 2026-07-05 | Phase 5-1 擴充：私訊「常見問題分類」上線。`/dashboard/messages` 新增「常見問題 Top」卡片——AI（gemini-2.5-flash, thinkingBudget 0）將 inbound 私訊分 8 類（例會時間／地點／**活動內容詢問**／如何加入／費用／體驗／聯絡／其他），統計各類佔比，**點列可展開範例訊息**。新 `app/api/messages/classify`（server 端抓文字→查快取→分類→存 `pages/{pageId}/msgIntents`→回 Top 意圖；原文只在 server + 回給該頁 admin，pageId 隔離）、`lib/messages/intents.ts`（分類法＋批次分類器＋`CLASSIFIER_VERSION`）、`components/dashboard/TopQuestions.tsx`。**雙層快取**：每則分類按 msgId 存（含版本號，改分類法自動重分類）；結果按範圍存 `msgIntentSummary/{30d\|90d\|all}`，6 小時內開頁秒回快取、不打 Graph/LLM，可按「↻ 重新分析」強制刷新。原文與結果均設 `expireAt` TTL 180 天。⚠️ Firestore TTL policy 需在 console 對 `expireAt` 開啟才會自動刪。詳見 `docs/phase-5-messaging-analytics-chatbot.md` §7 | (本次) |。根因非 bug 非權限：**Meta 於 2026-06-15 全面移除 `post_impressions_*` 家族（所有 API 版本），改用新 `views` 家族**；舊 metric 現回 `#100 "not a valid insights metric"`，而 cron 的 reach 抓取沒檢查 `insData.error`→靜默吞成 0。三支唯讀探針定案：`read_insights` 已授權（用 metaTokens 存的 userAccessToken 查 /me/permissions）、`post_reactions_by_type_total`/`post_clicks`/`post_video_views` 都讀得到，只有 impressions/reach 家族 #100；**新 metric `post_media_view`(貼文)/`page_media_view`(粉專) 實測可用**（v19–v22，回 184/130/387）。改 cron + 手動同步用 `post_media_view` + 補 error log。⚠️ 新 metric 是**觀看數 views**（非 unique reach，post 層級 unique 版已不提供）。並：廣告頁「同步廣告資料」→「同步最新資料」；內容儀表板資料區間列新增「↻ 同步最新資料」按鈕（同步 FB+IG 貼文含觸及）。詳見 memory `fb-reach-deprecated` | (本次) |：新增 `/dashboard/messages`，即時列舉 IG/FB 對話算「私訊則數 / 對話數 / 發問人數 / 每日私訊量 / 最近對話」，不存原文（隱私最小化）。BFF `/api/messages`（verifyIdToken + pageId 隔離 + page-scoped token）→ Graph `/{pageId}/conversations`（IG `platform=instagram`、FB `platform=messenger`）。連接流程加 scope `instagram_manage_messages`+`pages_messaging`（開發模式 admin 可直接授權，一般使用者需 Phase 5 單獨審查+商家驗證）。主控台加「💬 私訊分析」導覽鈕、頁面加「← 返回儀表板」。含 `<AiSidekick contextPage="messages">`。規劃見 `docs/phase-5-messaging-analytics-chatbot.md` | (本次) |
| 2026-07-04 | 修限動表格未依平台分頁過濾：切到 Instagram+Stories 卻同時顯示 FB 限動（反之亦然）。`filteredStories` 無條件把全部限動餵給 `IgStoriesTable`，未依 `activeTab` 過濾。改為 fb 分頁只回 `platform==='FB'`、ig 分頁只回 `'IG'`、combined 回全部 | `14d8f1a` |
| 2026-07-04 | 登入頁偵測 App 內嵌瀏覽器（webview）並提示改用 Safari/Chrome。根因：使用者從 LINE/FB/IG/Messenger/Threads/WeChat 內建瀏覽器點連結登入時，Google 依「Use secure browsers」政策禁止 webview 做 OAuth → `Error 403: disallowed_useragent`，卡在看不懂的 Google 錯誤頁。無法繞過政策，改用 UA regex 偵測常見 in-app browser，命中顯示提示橫幅引導改用系統瀏覽器。純前端偵測，桌機/一般行動瀏覽器不受影響 | `c24ce8d` |
| 2026-07-04 | App Review 精簡：移除 OAuth scope `pages_manage_posts`（原僅用於讀 FB Page Stories `/{page}/stories`）。唯讀分析工具不需「發文/管理」等級權限，且 FB 限動 insights 恆 0、會拖累審查；Meta 後台使用案例一併移除。IG 限動/貼文/廣告不受影響。新增 `docs/meta-app-review.md` 交付清單（送審 8 核心讀取權限）| `ef5db8d` |
| 2026-07-04 | 修「新 FB 貼文互動恆 0」復發。read-then-max（`fb1f422`）只防 cron 抹平**已存真值**，但全新貼文沒有前值可 max；而 cron 算互動的來源仍是不可靠的 per-post `/insights` metrics（`post_reactions_by_type_total`/`post_activity_by_action_type`），對剛發貼文回空/錯→catch 寫 0。手動同步走 `/posts` plain field 沒事，故只被 cron 碰過的新貼文卡 0（實測 Legacy 07/01 Meta 真值 10/0/0、07/02 6/0/1，Firestore 卻 0，且該兩則 `engagementAvailable=undefined`）。改為 cron 互動也讀 `/posts` plain field（`reactions.summary/comments.summary/shares`），`/insights` 只留 reach；兩條寫 fbPosts 路徑自此互動同源＋都 read-then-max。stuck 舊 0 貼文靠手動同步一次補回 | `ab63c55` |
| 2026-07-04 | 修內容儀表板「限動」分頁看不到 FB 粉專限動。根因＝顯示層：限動清單 fetch 本就不帶日期（IG 24h／FB 全抓），但客戶端 `filteredStories` 又用貼文的 `dateBounds` 過濾，而 FB「限動典藏」會回很舊的限動（實測提琉比舊到 2022），預設 30 天範圍全藏掉。改為限動不套用日期範圍、顯示全部已同步限動（表格 timestamp desc）。並更正 `IgStoriesTable` 空狀態文案（原錯寫「FB 限動 Meta API 無法讀取」）。⚠️ 實測 `GET /{pageId}/stories` 各粉專都回傳得到並存進 `fbStories`（共 94 筆），僅 FB 限動 insights 觸及/觀看恆為 0（Meta 限制）；memory `fb-stories-limit` 已據此重寫 | `6a120ac` |
| 2026-06-29 | 內容貼文改「依日期區間查詢」+ 表格分頁。讀取端 fb/ig route 接受 `since/until`（依 createdTime/timestamp 範圍查），選 7/30/90 天只讀該區間、選「全部」不帶 since 全查，統一安全上限 `READ_CAP=1000`；FB legacy 合併套同範圍（保持 `${pageId}_` 隔離）。前端改由「日期+選頁」useEffect 重抓，切區間即重查、不閃 loading；統計/折線圖用整個回傳區間算。新增共用 `TablePager`，FB/IG/合併三表排序後每頁 200 筆可翻頁（合計列仍以全部計）。並修 IG 讀取端原本寫死 `limit(50)`→200/依範圍；IG sync 一併翻頁+read-then-max | `ca1d64a` |
| 2026-06-29 | 修 FB 舊貼文互動數一直是 0：兩個 bug。①06bf924 用 `insights.metric(post_impressions_unique)` 欄位展開抓觸及，Meta 回 `(#100) must be a valid insights metric`，且欄位展開出錯會讓**整個 /posts 查詢失敗** → 連讚/留言/分享一起 500，FB 同步從那天起靜默掛掉（廣告頁只 console.warn）。移除欄位展開，互動數用 plain field 抓；reach 暫由 cron 負責。②手動同步原本只抓最新 1 頁（limit=50 不翻頁），歷史貼文永遠不刷新。改為跟 `paging.next` 翻頁（上限 10 頁），getAll/batch 分塊避開 Firestore 500 上限。實測一次回抓 404 篇、380 有互動、最舊到 2011。⚠️ reach 仍需用 per-post `/insights` 端點（不可塞 /posts 欄位展開）+ 驗證有效 metric，列為待辦 | `1199315` |
| 2026-06-28 | FB 貼文觸及補齊（之前內容儀表板 FB 觸及全空、只有 IG 有）。根因兩層：①顯示層 FbPostsTable 無觸及欄、合併表觸及只取 IG（FB-only 硬寫「—」）、折線圖總觸及只加總 IG；②抓取層手動同步根本不抓 reach，FB 觸及只靠不穩的每日 cron。修法：手動同步 fullFields 加 `insights.metric(post_impressions_unique)`（需 read_insights，已有）寫入 `insights.reach`＋read-then-max；FbPostsTable 加觸及欄；合併表觸及改 **FB+IG 合計**（與「總觸及」卡片同口徑）；折線圖 FB 迴圈補 reach | `06bf924` |
| 2026-06-27 | 修「所有粉專 FB 互動數整批變 0」：第二根因在每日 cron（`api/cron/sync` 的 `syncFbForUser`）——每篇打 `/{post}/insights`，呼叫失敗時 catch 回全 0，且原本 `batch.set` 直接整包覆蓋 `insights`（**無 read-then-max**），一次壞掉的 cron run 就把所有粉專真值抹平。手動同步早有的保護（b414e9c）漏補在這條 cron 路徑。改為先讀現有 doc、每個 metric 取 `max(舊,新)`，往後抓失敗不再清空。⚠️ 注意：兩條寫 `fbPosts` 的路徑（手動 `reactions.summary` vs cron post-insights metric）都要保留 read-then-max | `fb1f422` |
| 2026-06-26 | 修 FB 貼文互動數全 0：根因為 OAuth SCOPES 漏 `pages_read_user_content`，同步抓 reactions/comments/shares 被 Graph #10 擋下退回 basic（只存 0）。連接頁 SCOPES 補上該權限；重連授權後重新同步即可抓到並存入 Firebase（之後由 read-then-max 保護）。診斷用 `/debug/fb-probe`（並排 full/basic 回應）。⚠️ Dev mode 下此 scope 對有 App 角色者可直接授權，一般使用者需 App Review | `（本次）` |
| 2026-06-15 | 報名連結追蹤：報名金額幣別改下拉選單（TWD/JPY/KRW/USD…16 種 ISO 幣別，建立時帶入並回報 Meta CAPI Purchase）；Google 表單教學標題下加黃色提醒——兩種做法都需表單編輯權，非本人建立的表單要請擁有者加協作者或代貼 Apps Script，否則只能看點擊、完成恆為 0 | `（本次）` |
| 2026-06-13 | 報名連結追蹤：SetupGuide 內嵌 Google 表單教學，分兩種做法——A 只看 ContentLoop 自家「完成/轉換率/營收」（表單免加欄位）、B 要 Meta Ads Manager ROAS（加 1 題承載 cl_id，欄位名「專屬報名序號（系統自動帶入，請勿修改）」、值填 `__CLID__`）；兩段 GAS 可一鍵複製（WEBHOOK_URL 自動帶入、FIELD_TITLE 可改）；做法 B 附 4 張實機截圖（編輯器→Pre-fill 選單→填 `__CLID__`→Get link 複製，已裁掉個人頭像）；修正程式碼區塊在表格內撐寬溢出 | `（本次）` |
| 2026-06-13 | 報名連結追蹤：`/r` 支援 `__CLID__` 佔位字（Google 表單預填連結帶點擊碼，配 Apps Script onFormSubmit webhook 回報完成）；SetupGuide ①/② 說明改白話（點進表單數 / 真正完成數） | `（本次）` |
| 2026-06-13 | 報名連結追蹤：新增 Meta CAPI 設定精靈（全螢幕 9 步，第 0 步先選對商家組合）；設定卡修正切換粉專時成功訊息殘留（`key={pageId}` 重新掛載）；SetupGuide 把 `/r`（廣告貼）與 `/c`（表單貼）做成同 slug 配對防呆。文件補首次設定實戰路徑＋Dataset ID 找法 | `（本次）` |
| 2026-06-12 | 修正洞察報告分析內文不跟隨語系：report API 讀 body `language` + 新增英文 system prompt（鍵不變、值英文）；快取 fingerprint 納入語系（v5），ZH⇄EN 各自快取、切換語言重新生成而非沿用舊中文報告 | `8ff900c` |
| 2026-06-10 | 報名連結追蹤：自建短網址 `/r/{slug}`（點擊追蹤＋bot 過濾）、`/c/{slug}` 轉換回報（cookie／cl_id 對回）、表單 webhook；`/dashboard/links` 管理頁＋CSV 匯出。ROAS①：Meta Conversions API 回報（`/r` 擷取 fbclid→fbc，轉換時送 Purchase／CompleteRegistration，per-page 加密存 token＋測試事件）。登入頁加「返回首頁」。文件見 `docs/registration-link-tracking.md` | `4768462` |
| 2026-06-10 | 儀表板全面中／英雙語：設定切換英文後整站英文（含 AI Sidekick 回應、A/B 產出、生圖英文字體、診斷引擎、站內通知/Email 告警依使用者語言）；新增 `LanguageProvider` + `dashboard/layout` + 自訂英文日曆 `DateField`（繞過瀏覽器原生 date/file 在地化） | _本次_ |
| 2026-06-07 | 新部署流程：改完先 localhost 測，OK 才 commit/push（記入 CLAUDE.md + memory） | _本次_ |
| 2026-06-07 | 首頁支援 `/?lang=en` URL 帶語言 + 對應 metadata/hreflang（SEO、可分享）；頁面拆 server+client | `（前次）` |
| 2026-06-07 | 語言偏好用 localStorage 記住（下次造訪自動套用） | `（前次）` |
| 2026-06-07 | 行銷首頁加中／英語言切換（整頁文案切換） | `（前次）` |
| 2026-06-06 | 新增本 README（含維護規範）；首頁改為行銷頁 + 登入入口 | `1383933` |
| 2026-06-06 | 側欄「素材庫」改名「素材績效排行」+ 新增獨立「品牌素材庫」 | `6a811ec` |
| 2026-06-05 | 品牌素材庫（per page）+ 生圖自動疊 logo（sharp）+ 帶進 Canva | `ccd07d9` `20ebba8` |
| 2026-06-05 | Threads OAuth + sync 骨架，併進每日 cron | `e83b8d9` `12d58e8` |
| 2026-06-04 | 北極星反制指標（採納後成效改善率 + 後悔率）+ 特異性比對 | `4e8dce4` `aae8071` |
