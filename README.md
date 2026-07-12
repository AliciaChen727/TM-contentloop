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
| 3B | Agent 工具化（自查 Firestore、跨粉專比較、自我檢查、Bug 回報→HITL→修復） | 📋 規劃定稿 | `docs/phase-3b-agent-tooling.md` |
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
| 2026-07-12 | **Phase 3B Slice 18 — Bug 回報 pipeline**：`lib/bugs/bugReporter.ts`（haiku 分類 → `bugReports` 冪等 → 鈴鐺通知 super-admin → GitHub Issue，env `GITHUB_BUG_TOKEN`）；偵測點＝cron 殭屍快照（critical）、Sidekick 工具 guard、publishRunner 發布失敗。只回報不自動修；修復待 Slice 19（雙重 HITL）。E2E 驗證含 Issue 開立 | (本 commit) |
| 2026-07-12 | **Phase 3B Slices 16–17 + cron 跨頁污染根治**：(1) Sidekick 接 Tool Runner（查 Firestore、`compare_pages` 跨粉專比較、當前粉專範圍鐵則、貼文用內容+連結描述）；(2) `/dashboard/compare` 跨粉專總覽（admin-only：廣告表格＋全域日期篩選＋粉專多選＋素材趨勢圖＋廣告受眾＋IG 粉絲樣貌＋貼文比較），內容儀表板加 IG 粉絲樣貌卡；(3) cron 廣告 snapshot 改頁過濾聚合（修 Legacy/D67 花費互相污染，詳 memory `project_cron_ads_page_filter`）＋ manual sync shared 寫入改任何頁匹配素材即寫（已結束戰役的趨勢/受眾才進得了共享快照）＋ cron 新增 IG `follower_demographics` 每日同步 | (本 commit) |
| 2026-07-11 | Phase 3B 規劃定稿 + **Slice 15**：`docs/phase-3b-agent-tooling.md`（tool-use agent 升級、跨粉專總覽、bug 回報→雙重 HITL→修復，Slices 15–19）；新增 `lib/ai/tools/pageDataTools.ts`（Firestore 工具層＋pageId 白名單隔離）；診斷卡片 agent 升級 sonnet tool loop（`runDiagnosisAgentWithTools`，查趨勢＋核數字，fallback haiku 單發）；裝 `@anthropic-ai/claude-agent-sdk` | (本 commit) |
| 2026-07-12 | App Review 第二輪規劃（發文權限）：`docs/meta-app-review.md` 新增第 7 節——在 app `832755139382467` 送 `pages_manage_posts` + `instagram_content_publish`（附 content-drafts 發布流程 screencast 腳本、HITL 防濫用說明、測試帳號注意事項）；Threads 免送（獨立 OAuth）。App 對照更正入 memory：832=實際串接/送審 App、858=僅 FB 登入（Firebase Auth provider） | 4d16ed4 |
| 2026-07-12 | 草稿編輯器：FB 為目標且未 go live 時顯示「FB 發布僅預覽模式」警告橫幅；隱藏 FB 封面截圖 UI（前提已證偽，留著誤導使用者），欄位/發布邏輯保留供 go live 後續用 | 68b7aa8 |
| 2026-07-12 | 排查定案（文件/memory 更正）：**dev mode 期間 API 發到 FB 的所有內容（文字/圖片/影片/封面截圖）僅 App role 可見**，外部帳號逐篇驗證確認；先前「文字/圖片豁免」為誤判（僅用 App Admin 帳號驗收），「暫時性降觸及」假設作廢。IG/Threads 不受影響、Business Suite 手動發正常。產品結論：go live 前 ContentLoop 的 FB 發布視為預覽模式，正式 FB 貼文用 Business Suite 手動發；App Review 優先級提高；驗收鐵則=可見度一律用非 App role 帳號驗證。詳見 `apps/web/docs/content-draft-story-publishing.md` | (文件) |
| 2026-07-11 | 草稿背景音樂 Slice 2（粉專曲庫）＋ ffmpeg 正式環境修復：(1) **粉專曲庫** — 新增 `pages/{pageId}/musicTracks`（page-scoped），管理端在廣告儀表板「品牌素材庫」頁新增 `MusicLibraryCard`（上傳/命名/試聽/刪除），草稿編輯器 `AudioComposer` 新增「從曲庫選擇」（唯讀選用），一次上傳、重複使用。查證 Meta／Canva 官方音樂曲庫皆不開放第三方 API（Canva Assets API 僅支援 image/video），故仍走音訊燒入媒體檔的合成路線。(2) **ffmpeg 正式環境 ENOENT 修復** — Vercel file tracing 追不到 `ffmpeg-static` 二進位檔（monorepo workspaces 又裝在 repo 根目錄），導致音樂合成／FB 封面截圖／發布／限動補發／排程 cron 五條 route 在正式環境全部失敗；修法於 `next.config.mjs` 用 `outputFileTracingIncludes` 逐一宣告打包。詳見 `apps/web/docs/content-draft-music.md` | 3cda738 |
| 2026-07-11 | 草稿加背景音樂（Slice 1）＋ FB 影片 dev mode 排查與封面 fallback：(1) **音樂合成** — 單圖/影片草稿可上傳音檔（≤20MB），server ffmpeg 合成（圖→12 秒 9:16 影片、影片→取代原聲），合成結果即草稿媒體（預覽=發布，HITL）；Meta 官方曲庫不開放 API，僅支援自備免版稅音檔。(2) **FB 影片 dev mode 全面不可見（對照實驗定案）** — API 發的 FB 影片（/videos 會被轉 Reel、/video_reels 皆然）只有 App role 看得到甚至被移除，同檔 Business Suite 手動上傳正常；過渡對策=`FbCoverPicker` 影片截封面圖（`generated.fbCoverImageUrl`），FB 發圖片、IG/Threads 照發音樂影片；統一開關 `NEXT_PUBLIC_META_APP_LIVE`，go live 設 1 → FB Story+完整音樂影片一次恢復。(3) **Invalid token 修復** — content-drafts 頁改用 `freshIdToken()` 每次請求取新 token，頁面開超過 1 小時不再 401。詳見 `apps/web/docs/content-draft-story-publishing.md` | 4a989f8 |
| 2026-07-10 | 修復發布兩大坑（FB+IG 一鍵發布實測定位）：(1) **FB 假失敗** — Meta 回 code 1「Please reduce the amount of data…」暫時性錯誤但貼文其實已發出，導致記成失敗、拿不到 postId、重試會重複發文；修法＝宣告失敗前回讀粉專 feed 比對文案開頭+時間（`findJustPublishedPost`）。(2) **一平台失敗連坐** — FB 失敗把草稿標 `failed`，publish route 409 擋掉後續 IG（主貼+限動全沒發）；修法＝route 允許 `failed` 狀態續發剩餘平台（冪等檢查防重複）。另新增 IG Story 預覽 tab（`StoryPreview.tsx`，9:16 模擬畫面，勾限動+含 IG 時出現） | 2a0ef9e |
| 2026-07-10 | FB Story 發布停用（Development mode 黑畫面）：確認同 app 發的 FB 主貼與 IG Story 一般人都看得到、唯獨 FB Story 只有 Meta App role 看得到，黑畫面判定為 dev mode 可見性限制而非格式問題。新增 feature flag `NEXT_PUBLIC_FB_STORY_ENABLED`（`lib/content/fbStoryFlag.ts`，預設停用，go live 後設 `1` 重開）：Composer FB 限動勾選 disabled + 說明、`publishRunner` server 端跳過 FB Story（含排程舊草稿，寫 `storyNote`）、「補發 FB 限動」收緊為僅 owner（驗證/上線後補發用）。IG Story 不受影響。詳見 `apps/web/docs/content-draft-story-publishing.md` | 2a0ef9e |
| 2026-07-10 | 文件：補充 FB Story 黑畫面待驗證假設。即使 `video_stories` 回 `published` 且 MP4 已改為 H.264 baseline + silent AAC，非 Meta App role viewer 仍可能看到黑畫面；下一步需用 Meta Developer Tester 對照驗證 Development mode / App role 可見性限制。詳見 `apps/web/docs/content-draft-story-publishing.md` | (文件) |
| 2026-07-10 | 修復 FB 圖片限動黑畫面風險：root cause 為 `photo_stories` 雖回 `published`，但用主貼橫式/輪播首圖直接建立 Story 時，多個一般 viewer 會看到黑畫面。FB 圖片 Story 發布前改用 `sharp` 產生 1080x1920 JPEG（blur/darken 背景 + 原圖置中），再用 `ffmpeg-static` 轉成 5 秒 MP4，改走 `video_stories`；新增已發布草稿的「補發 FB 限動」動作，只更新 Story、不重發主貼或 IG/Threads；詳見 `docs/content-draft-story-publishing.md` | 2a0ef9e |
| 2026-07-10 | AI 草稿標記第一版：新增 `pages/{pageId}/taggableEntities` 已知標記名單、同步歷史貼文與 Graph API 回補 FB posts（`message_tags`/`tags`/`place`/`comments.from`）、草稿 `tagging` 欄位與 server-side 驗證；Composer/編輯頁加「進階標記」與 textarea `@` 搜尋選取，並用 chips 顯示已選項目；Admin/Editor 可從已知名單選 FB 個人插入姓名/地點、IG @/地點、Threads 地點；發布時 FB 地點會轉成 Meta API payload，FB 個人因 Meta 限制只插入純文字姓名，不支援 profile link 或真正 tag；FB 粉專不提供選取或自動插入。Follower/FB 名單限制已文件化：Meta 不提供完整 follower 身分清單，IG username 也不能直接轉成 FB tag，留言者先列候選需確認；`#hashtag` 會排除在個人名單外，IG 可手動新增 `@username`。詳見 `docs/content-draft-tagging-plan.md` | (本次) |
| 2026-07-09 | RBAC 修正：Dashboard header 改用目前粉專的 page-scoped role/capabilities；Editor 可生成/編輯草稿、管理報名連結與 AI chatbot 設定/測試，但刪除/核准/排程/發布與 chatbot 上架仍限 Admin；未連 IG/Threads 的粉專禁止建立/發布對應平台草稿 | (本次) |
| 2026-07-09 | 文件/memory：補充 Meta Development mode 下 ContentLoop admin 共用 owner FB/IG page token 的規則、何時仍需 Meta Developer tester、以及 Threads 獨立 OAuth 例外 | (文件/memory) |
| 2026-07-09 | RBAC 對齊：Viewer 可進入報名連結追蹤並唯讀統計/CSV；品牌素材庫改為 Viewer 可讀、Editor/Admin 可新增刪除；AI Sidekick 對受邀 viewer/editor 改用頁面 owner/env Claude key，不再要求各自輸入 API key | (本次) |
| 2026-07-08 | 修復 Threads 發布時遇到 "The requested resource does not exist" 問題：TEXT 類型貼文建立後需短暫同步時間，補上 `waitReady` 輪詢機制並修正其 error retry 邏輯；另修復 Firestore Admin SDK 寫入 `undefined` 導致崩潰問題（啟用 `ignoreUndefinedProperties`），並在「收回核准」時自動清除舊的發布失敗紀錄 | `2612f33` `6b9216e` `6c8dfb9` |
| 2026-07-07 | Agent 自動發布 S1+S2（草稿基建＋審核 UI）。`lib/content/draftTypes.ts`（狀態機 `DRAFT_TRANSITIONS`）＋ `draftStore.ts`（page-scoped CRUD）＋ `/api/content-drafts`(＋`[id]`)（BFF，admin-only，viewer 看不到草稿）。審核頁 `/dashboard/content-drafts`：待審/已核准/已發布分頁＋核准·拒絕·編輯（HITL：未核准絕不發）。Composer：上傳影音（`uploadDraftMedia`→Storage）＋即時預覽（FB/IG/Threads 切換）＋Threads 超 500 字自動切回覆串（`lib/publish/threadsSplit.ts`）＋hashtags 套用全平台。**✨ AI 生成文案**：設定面板（語言/文案目標/語氣/CTA/依產業必要資訊）＋參考成效最好的歷史貼文 few-shot（`historyExamples.ts`，頁隔離）→ `/api/ai/caption`（Haiku，只生文案不生圖）。主儀表板功能鈕收成 ☰ 漢堡選單（`NavMenu`）。Skill `.claude/skills/auto-publish-agent`。規劃見 `docs/agent-auto-publish-plan.md` | (本次) |
| 2026-07-05 | Phase 5-2b-2：Meta 私訊 webhook（**dry-run，不真發送**）。`app/api/webhooks/meta`（GET `hub.challenge` 握手驗 `META_WEBHOOK_VERIFY_TOKEN`；POST 驗 `X-Hub-Signature-256`(App Secret) → 解析 Messenger/IG 訊息 → IG 用 `collectionGroup(metaTokens).igUserId` 映射回 pageId → 跑 `generateReply`(含 few-shot) → 記進 `pages/{pageId}/faqBot/inbox`，`wouldSend`/`sent:false`，**不發送**）。`/api/messages/faq/inbox` GET + 設定頁「📥 收到的私訊（試跑）」檢視。需設 env `META_WEBHOOK_VERIFY_TOKEN` + Meta 後台訂閱 `messages`。5-2c 才真發送 | (本次) |
| 2026-07-05 | Phase 5-2b 優化迴圈 T2+T3：**T2 回饋分析**（`/api/messages/faq/feedback` GET 聚合 👍/👎、最常倒讚意圖、近期倒讚案例）；**T3 few-shot 自我學習**（回饋存 question embedding `gemini-embedding-001`；`lib/messages/feedbackFewShot.ts` `getFewShot` 用 `cosineSim` 檢索 rating=up 相似歷史 top-k(sim>0.6) → preview 傳給 `generateReply` 當風格 few-shot）。設定頁：「AI 學到的更正」+「回饋分析」整併成右側「🧠 學習與回饋」（試回覆下方）；置頂加粉專名稱 | (本次) |
| 2026-07-05 | Phase 5-2b-1：AI agent 回覆引擎 + 試回覆 + 回饋迴圈。`lib/messages/replyAgent.ts`（分類→**grounding 全餵**：corrections+排程+所有意圖答案+補充知識一起給 LLM，不被單一分類 gate；日期走 `nextMeeting` 純程式；都不相關→`[[HANDOFF]]`→轉真人；標準 haiku／進階 sonnet）。`/api/messages/faq/preview`（dry-run 不發送）、`/api/messages/faq/feedback`（👍👎 存 `feedbackItems`；**T1 倒讚+更正→arrayUnion 進 `config.corrections`，agent 一律優先參考→下次同問題即生效**）。設定頁改**左設定＋右 sticky 聊天式試回覆**（訊息泡泡＋👍👎＋倒讚原因）＋「AI 學到的更正」清單＋「回覆品質」開關。修：API 呼叫改即時 `getIdToken`（解 token 過期「Invalid token」）。優化迴圈 T2/T3 規劃見 docs §8.8 | (本次) |
| 2026-07-05 | Phase 5-2a 例會排程三種匯入：貼上／**CSV 上傳**／**Google Sheet 同步**（SA-share，非 OAuth）。`lib/messages/sheetsClient.ts`（`GoogleAuth`+`spreadsheets.readonly`，gid→title→values→flatten）+ `/api/messages/faq/sheet`（GET 回 SA email、POST 同步）。**所有粉專管理者共用同一 SA email**（= GA4 `firebase-adminsdk-fbsvc@…`，程式支援 `GA_SA_*` 專用 SA），前置需啟用 Sheets API；設定頁 UI + docs §8.5 已寫明共用規則。`parseSchedule` 加智慧過濾：輸入含 `#會次` 或例會關鍵字時只認標記日期、否則抓全部。⚠️ 需在 GCP 對 `contentloop-dev` 啟用 Google Sheets API | (本次) |（尚未真的回覆）。新 `/dashboard/messages/faq` + `/api/messages/faq`（admin 讀寫、pageId 隔離，存 `pages/{pageId}/faqBot/config`）：總開關 + 沒把握轉真人 + 語氣/persona + 補充知識 + 各主題答案（接分類器 8 意圖）+ fallback + **例會排程**（貼 Google Sheet/Excel→`lib/messages/parseSchedule.ts` 解析日期→存，5-2b 用「今天後最近一場」精準回下次例會）。定位為 **AI agent（平台無關核心 + Meta/未來 LINE adapter）**，非固定模板。⚠️ 排程目前用貼上；未來可評估 Google Sheets API 自動同步 或 CSV 上傳解析。詳見 `docs/phase-5-messaging-analytics-chatbot.md` §8 | (本次) |（今日→30 日前）。移除「用 `adData.overview.dateRange` 覆蓋 picker」的 effect（原本一載入就跳成廣告資料實際區間）。仍可手動改或用快捷鈕 | (本次) |
| 2026-07-05 | Phase 5-1 擴充：私訊「回覆表現 + 尖峰時段」。`/api/messages` 加算 `responsiveness`（每對話「首則 inbound→首則 outbound」間隔中位數 + 回覆率）與 `hourly`（inbound 依台北小時分桶 24 格）；`MessageStats` 加「回覆表現」卡（首次回覆中位/回覆率）與「尖峰時段」長條圖。受每對話抓最近 100 則限制 | (本次) |
| 2026-07-05 | Phase 5-1 擴充：問題分類改**背景 cron 預熱**。分類核心抽成共用 lib `lib/messages/classifyPage.ts`（`/api/messages/classify` route 瘦身成驗身+隔離+呼叫）；新 `app/api/cron/classify-messages`（CRON_SECRET + `collectionGroup('metaTokens')` 掃全頁、force 重算 30d/90d）+ `.github/workflows/classify-messages.yml`（每 6h，與快取 FRESH_MS 對齊）。per-msgId 快取讓 cron 只對新訊息打 LLM。效果：使用者開 `/dashboard/messages` 永遠秒回快取、不用等 AI。用既有 GitHub secret `CRON_SECRET` | (本次) |
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
