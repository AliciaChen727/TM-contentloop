# ContentLoop

> **AI-powered content and ad performance dashboard for Meta social media.** ContentLoop was built for personal brands, businesses and organizations that want a one-stop dashboard to review the performance of their Meta social media presence (Facebook Pages, Instagram, Threads) and their ad results. It pulls posts, stories and ad insights from the Meta Graph API, stores them page-scoped in Firestore, and presents them in a Next.js dashboard with AI diagnosis, insight reports, an AI Sidekick, anomaly notifications and an approval-gated publishing workflow.

Live: <https://tm-contentloop.vercel.app/> · Sign in: <https://tm-contentloop.vercel.app/auth/login> · Docs: <https://aliciachen727.github.io/TM-contentloop/>

---

## ⚠️ Maintenance rule (read this first)

> **Every "major code change" or "memory update" must be reflected back into this README.**

- **Major code change** = new feature, architecture change, diagnosis-rule change, API added or changed, new external integration, deployment change. Typo-level edits are exempt.
- **Memory update** = adding or editing any file under `~/.claude/.../memory/` (including `MEMORY.md`).
- How: update the relevant section **and** add one row to the [Change Log](#change-log-變更紀錄) at the bottom (date + one-line summary + commit). Mirror the row in English in `site-docs/release-log.md` so the public docs site stays in sync.
- The same rule lives in `CLAUDE.md` and is surfaced in every AI session.

---

## Project status

| Phase | Scope | Status | Doc |
|-------|-------|--------|-----|
| 1 | Meta OAuth + scheduled FB/IG sync + dashboards | ✅ Live | — |
| 2 | In-app notification center (red dot) + scheduled email alerts | ✅ Live | `docs/phase-2-notification-center.md` |
| 3 | AI Sidekick optimization loop + self-learning (evaluator / quality score / feedback memory, native Anthropic agent) | ✅ Live | `docs/phase-3-sidekick-self-learning.md` |
| 3B | Agent tooling (Firestore tools, cross-page compare, self-check, bug report → HITL → fix agent) | ✅ Delivered | `docs/phase-3b-agent-tooling.md` |
| 3C | ChatOps via Telegram | ✅ Delivered | `docs/phase-3c-chatops-agents.md` |
| 4 | Semi-automated ad updates (Meta Marketing API writes, needs App Review) | 📋 Planned | `docs/phase-4-ad-automation.md` |
| 5 | Messaging analytics (5-1 live) + FAQ auto-reply chatbot (5-2 dry-run) | 🔄 In progress | `docs/phase-5-messaging-analytics-chatbot.md` |

Extended integrations: **Threads** (content performance, separate OAuth, live in the content dashboard), **GA4** (supplementary data for customers running Google Ads, self-service wizard), **LinkedIn** (planned, gated on API approval). See `docs/`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| Backend (BFF) | Next.js API Routes (same bundle as the frontend) |
| Scheduled backend | Firebase Cloud Functions (Node.js 20), GitHub Actions cron, Vercel Cron |
| Database | Firestore |
| Auth | Firebase Auth + Meta OAuth 2.0 |
| External APIs | Meta Graph API, Claude, Gemini, fal.ai, Canva, Threads, GA4 Data API, Gmail SMTP |
| Hosting | Vercel (frontend + API) + Firebase (Functions) |

**Models**: `claude-sonnet-4-6` (Sidekick chat, insight reports, diagnosis agent tool loop), `claude-haiku-4-5` (creative generation, diagnosis fallback), `gemini-2.5-flash` (quality evaluator judge), `gemini-embedding-001` (few-shot retrieval). The diagnosis engine itself is rules only, no model. Images and video go through the owner's GCP Vertex AI service account.

---

## Architecture (the mental model that matters)

This is **not** a classic split frontend/backend. It is a **Next.js full-stack monolith with a BFF layer**:

```
Browser (React UI)
   │  calls only our own API, never reads Firestore directly
   ▼
/api/*  (BFF routes running on Vercel)
   │  verifyIdToken + Firebase Admin SDK
   ├─► Firestore (data)
   ├─► Meta / Claude / Gemini / fal.ai / Canva / Threads / GA4 (external)
   └─► (scheduled) Firebase Functions + GitHub Actions cron
```

- **UI and API routes live in one codebase, build together and deploy together to Vercel.**
- **Firebase Functions is the only truly separate backend** (scheduled publishing).
- Details in `docs/architecture.md` and the public [Architecture page](https://aliciachen727.github.io/TM-contentloop/architecture/).

### Hard rule: the client never reads Firestore directly
Security rules block it, so a direct read fails the login flow. All data access goes through `/api/*`. See memory `project_client_firestore_login`.

---

## Repository layout

```
TM-contentloop/
├─ apps/web/                  # Next.js (frontend + BFF API) ← main codebase
│   ├─ app/                   # App Router pages
│   │   ├─ page.tsx           # Marketing landing page (login entry)
│   │   ├─ auth/              # Login / connect Meta / callback / onboarding
│   │   ├─ dashboard/         # Dashboards (ads / content / messages / drafts / settings…)
│   │   └─ api/               # BFF routes (cron / ads / insights / ai / auth…)
│   ├─ components/            # React components (ads/ analytics/ content/ …)
│   ├─ lib/                   # Pure logic (ads/diagnosis, sidekick/, meta/, ai/…)
│   └─ next.config.mjs        # includes /__/auth/* rewrite (same-origin auth fix)
├─ functions/                 # Firebase Cloud Functions (scheduled publishing)
├─ site-docs/ + mkdocs.yml    # Public English docs site (GitHub Pages)
├─ docs/                      # Planning documents (single source of truth per phase)
├─ CLAUDE.md                  # Project worldview + AI collaboration rules
└─ README.md                  # ← this file
```

---

## Key features

- **FB + IG + Threads performance dashboard**: scheduled sync of posts, ads and stories after Meta authorization, stored page-scoped.
- **AI diagnosis engine**: compares metrics against goal-specific thresholds and flags issues with actionable advice. **Rules live in one file**: `apps/web/lib/ads/diagnosis.ts` (change a threshold there and all three consumers update).
- **AI Sidekick**: chat assistant with live metrics in context; drafts captions and generates images; self-learning loop (behavior-aware evaluator + few-shot feedback).
- **Automated insight reports**: industry benchmarks, best posts, ad A/B, next steps; Firestore cache with fingerprint-based invalidation.
- **In-app notifications + email alerts**: per-user red-dot notifications and scheduled alerts; only critical/warning are sent.
- **Content drafts and publishing**: AI captions per platform, high-fidelity preview, human approval, publish or schedule to Threads / FB / IG with kill switch and quiet hours.
- **Creative generation × brand asset library**: AI image generation; uploaded logos are composited pixel-exact with sharp, or handed to Canva in one click.
- **Messaging analytics**: read-only IG/FB DM statistics, intent classification, response performance; FAQ auto-reply agent in dry-run.

---

## Development (monorepo, code in `apps/web`)

```bash
cd apps/web
npm run dev          # local dev
npx tsc --noEmit     # type check
npx eslint <files>   # lint
npm run build        # production build
```

**Discipline**: after every change, `tsc` + `eslint` + `next build` must **all pass** before committing.

**Deploy flow (since 2026-06-07)**:
1. Make the change → all three checks green
2. **Run `npm run dev` and let the owner test on localhost (http://localhost:3000)**
3. Only after the owner says "OK": `git commit` + `git push` (main → Vercel auto-deploys frontend + API)
4. `functions/` changes → `firebase deploy`

> ⚠️ Do not push before the owner has verified on localhost. Documentation-only changes (README / docs / memory / site-docs) are exempt from the localhost step.

---

## Environment and secrets

- Firebase project: `contentloop-dev` (Blaze plan)
- Meta App: Business type, Live mode (App Review passed 2026-08)
- All secrets and tokens live only in `.env.local` (frontend) or Firebase Secret Manager / Vercel env (backend). **Never commit them.**

---

## Multi-page data isolation (must pass before every release)

A user may be admin of several pages at once. **Whenever a request carries a `pageId`, every read of posts, insights or ads must be bounded by that `pageId`**, for viewer / admin / owner / super-admin alike.

- FB legacy collections must be filtered by the `` `${pageId}_` `` prefix; IG legacy is never read when `pageId` is known.
- Acceptance: sign in as an admin who manages pages A and B; viewing A must show nothing of B.
- Details in `CLAUDE.md` and memory `feedback_page_isolation`.

---

## Related documents

- `CLAUDE.md`: project worldview, AI collaboration rules, diagnosis single source of truth, isolation rules.
- `docs/architecture.md`: system architecture.
- `docs/goal-metrics.md`: ad goal → metric mapping.
- `docs/phase-*.md`: per-phase planning.
- **Public docs site (English)**: https://aliciachen727.github.io/TM-contentloop/ — MkDocs Material, sources in `site-docs/` (Home / PRD / Architecture with Mermaid / Release Log). Pushing to `main` with changes under `site-docs/**` or `mkdocs.yml` triggers `.github/workflows/docs.yml`, which deploys to GitHub Pages.
- AI memory index: `~/.claude/projects/-Users-pei-wenchen-Files-TM-contentloop/memory/MEMORY.md`

---

## Change Log (變更紀錄)

> Rule: on every major code change or memory update, add one row here (date + summary + commit), newest first. Historical rows are kept in their original Chinese; the English mirror is the [Release Log](https://aliciachen727.github.io/TM-contentloop/release-log/) on the docs site.

| Date | Change | Commit |
|------|--------|--------|
| 2026-09-06 | **README 全面英文化 + 重新定位 + Release Log 同步**：README 描述段落改英文，定位從「Toastmasters 分會用」改為「為個人品牌、企業與組織打造，一站式檢視 Meta 社群成效與廣告成效」；PRD / 文件站首頁同步改定位；`site-docs/release-log.md` 改為逐行鏡射本表（2026-06-04 → 今）並保留 git 推導的 2026-05 早期歷史；專案現況表更新至實況（Phase 3/3B/3C 完成、5 進行中）。維護規範新增「補列時同步英文 release log」 | `54836d0` |
| 2026-09-06 | **新增 GitHub Pages 英文文件站**：根目錄 `mkdocs.yml` + `site-docs/`（Home、PRD、Architecture 十張 Mermaid 圖、Release Log 依月份整理 2026-05→08），MkDocs Material 內建搜尋、TOC、深淺色、右上 GitHub repo 連結；`.github/workflows/docs.yml` 用 `actions/deploy-pages` 部署（Pages source = GitHub Actions）。本機 `python3 -m mkdocs build --strict` 全綠 + Playwright 實開頁面確認 Mermaid 渲染（修掉兩處語法：sequence 訊息含 `;`、edge label 含 `{}`）。`site/` 加進 .gitignore | `1f29216` |
| 2026-08-22 | **修 publishResults 深合併殘留 + 保留失敗歷史**：那篇 IG retry 成功後，Firestore 竟變成 `{ error:"Fatal", postId:"1811…" }` **error 與 postId 並存**。根因不是「忘了清」——`recordPublishOutcome` 本來就整包替換 `[platform]`（成功時物件無 `error` key），但 **`set(patch,{merge:true})` 對巢狀 map 是深合併**，少掉的 key 不會消失 → 舊 error 復活（**同 `linkClicks` 事故那條**）。目前判失敗是 `error && !postId` 所以沒出事，但任何寫 `if (r.error)` 的新程式碼都會誤判。修法：(1) 抽純函式 `lib/content/publishResultEntry.ts` 的 `buildPlatformEntry()`（比照 `matchesPage` 抽法）——成功時不帶 `error` 並回報 `clearedKeys`，呼叫端用 `FieldValue.delete()` 真正刪除；**同時把上次的 error 搬進新的 `failures[]`（上限 5 筆）**，誤導性 error 消失但「曾經失敗」不流失。(2) `draftTypes` 的 `publishResults` 加 `failures?: {error,at}[]`。(3) 新增 8 個測試，核心那個重現 8/17→8/22 真實序列。**資料補正**：DRY RUN 掃 45 篇草稿找到 **3 篇**中招（IG `Fatal`、Threads `Application does not have permission`（留言串，對應 manage_replies scope）、Threads `UNKNOWN`），全部已修正並複驗回 0 筆。77 測試全過 + 三關綠。⚠️ UI 尚未顯示 `failures`（資料存著但看不到），要不要加待決 | （本次） |
| 2026-08-22 | **IG 發布錯誤保留 Meta 完整資訊**（原本只存到 `Fatal`）：2026-08-17 Legacy 一篇排程輪播（10 圖）FB 發成功、IG 失敗，但 `publishResults.ig.error`、`bugReports` detail、UI 徽章三處存到的都只有 **`Fatal`** 五個字 → 完全無法追查。根因＝`lib/meta/publishIg.ts` 只取 `j.error.message`，而 Meta 的 message 本身沒資訊量（`code -1` 通用錯誤），同一個 error 物件裡真正有用的欄位被整包丟掉。修法：(1) 新增純函式 `formatMetaError()` 保留 `error_user_title`/`error_user_msg`（可行動說明）+ **原始 message 絕不丟**（對照 Meta 文件的鍵）+ `code`/`error_subcode`/`type`/**`fbtrace_id`**，同字串只留一次。(2) `waitReady` 改取 `fields=status_code,status` —— container 失敗時 IG 把原因寫在 `status`，原本只查 `status_code` 只拿得到光禿禿的 `ERROR`；並補上 polling 回應自身帶 `error` 的處理（原本會被當「還沒好」一路 continue 到 90s 逾時）。(3) **輪播錯誤指出第幾張 + 檔名**（10 張平行建 container，原本不說哪張＝無法重現）。新增 `lib/meta/publishIg.test.ts`（7 測試），第一個把 2026-08-17 真實 payload `{message:"Fatal", code:-1, fbtrace_id}` 釘成回歸案例。⚠️ 實作第一版在 `error_user_title` 與 `error_user_msg` 同時存在時會丟掉原始 message（**正是本次要修的病**），由測試紅燈抓到後修實作。**不改任何成功/失敗判定**，發布流程/狀態機/publishRunner/UI 皆未動；70 測試全過 + 三關綠；此路徑僅在 IG 真實失敗時觸發，未端到端驗證。附帶查明：該篇「Retry publish」是安全的——`publish/route.ts:54` 對已有 `postId` 的平台回 `alreadyPublished`，不會重發 FB | `d4721b5` |
| 2026-08-22 | **Phase 5-2c-0 webhook runtime 重構（仍 dry-run，不發送）**：`api/webhooks/meta/route.ts` 原本在 `return 200` 前同步跑 `getFewShot`（Gemini embedding）+ `generateReply`（Claude haiku），本機實測完整尾巴 **3.5 秒**，冷啟動時易破 Meta 逾時門檻 → **Meta 重送 webhook**，而 inbox 用 `.add()` 隨機 doc id → 重送就重複寫（dry-run 只是多幾筆假資料，**5-2c 一開真發送就是重複發訊息給會友**）。改法：(1) POST 只做「驗簽 → 每則 `metaWebhookEvents/{mid}.create()` → 回 200」，agent 生成與寫 inbox 丟進 `waitUntil` 尾巴（新增 `@vercel/functions`；`unstable_after` 需 Next 15，本專案 14.2.35 用不了）。(2) **冪等狀態機**（非布林旗標）：用 Meta `mid` 當 doc id + `runTransaction` 認領——`done` 跳過、`processing` 租約(3min)內跳過、**`failed`/租約逾期則重新認領**；inbox 改 `.doc(mid).set()` 雙保險。⚠️ 中途踩過：先用 `create()` 當旗標，但因為是先回 200 再做事，尾巴一失敗 Meta 重送就撞已存在 → **訊息永久丟失且無人察覺**（等於拿「重複」換「掉訊息」），故補狀態機。(3) 🔒 `metaWebhookEvents` 是 top-level（拿到 mid 時尚未解析 pageId），**只存識別欄位 + `expireAt` TTL 30 天、不存訊息內容**，原文只在記憶體傳給尾巴、最後寫進 page-scoped inbox → 不違反跨頁隔離。(4) ⚠️ **`waitUntil` 在非 Vercel 環境不會 throw**（實測，只是不保證存活）→ 不能用 try/catch 偵測，改以 `process.env.VERCEL` 分流：本機直接 await（可觀察可測）、正式站走 waitUntil。驗證（五情境）：首次 200/4972ms/done、重送跳過 124ms、**failed 後重送救回**(attempts=2)、租約逾期重認領、租約內跳過；壞簽章 401；測試資料已清。⚠️ 本機以 `VERCEL` 分流故**全走 await 分支——`waitUntil` 正式路徑本機驗不到**，真正驗收是部署後對正式 URL 重跑腳本（首次延遲應掉到 ~100ms 量級、inbox 數秒後才出現）。⚠️ `metaWebhookEvents` 是新 collection，需在 Firestore console 對它開 TTL policy，`expireAt` 才會生效。另補文件：Phase 5 doc §3/§8.1「Firebase Cloud Function」更正為 Vercel route（文件漂移）+ 新增 §8.9；`docs/meta-app-review.md` 新增 §10——**Live mode ≠ 權限對外生效**（Standard Access 只服務有 app role 者，官方原文）＋**🚨 私訊兩權限是以「絕不回覆」的唯讀用途送審的，5-2c 自動回覆屬用途不符，須重新送審**。⚠️ 待辦：owner 需到 App Dashboard 查 `pages_messaging`/`instagram_manage_messages` 目前是 Standard 還是 Advanced Access（repo 沒記錄 2026-08-09 那批 12 個權限逐一結果） | （本次） |
| 2026-08-09 | **onboarding 移到授權後 + 修 onboarding API 越權 + 清點號髒資料**：(1) 新增 `app/auth/(auth-group)/onboarding/page.tsx`，Meta OAuth callback 從 `/dashboard` 改導向此頁；用 `/api/pages?tokensOnly=true`（**不可用完整清單，否則 super-admin 會被要求幫全站粉專填**）算出缺 `optimizationGoal` 的粉專依序問，無待填則直接轉進儀表板，任何錯誤一律放行不擋人。**佇列只在載入時算一次**——`skip` 只寫 `users/{uid}` 不標記粉專完成，每步重問伺服器會讓略過者無限迴圈。原因：舊觸發條件是「進儀表板且該頁 goal 為空」，實測 8 個粉專有 1 個從沒填過，而 industry/goal 是同業 benchmark 與 AI 建議的輸入。(2) 🔒 `/api/user/onboarding` 的 GET/POST 原本只驗身分**不驗粉專存取權**，任何登入者帶別人的 pageId 就能讀取甚至**覆寫**其 onboardingData（含 brandName/extraContext）→ 加 `getUserPageAccess` 檢查回 403。(3) 清掉 Legacy/D67 上舊版寫法遺留的字面點號欄位（`onboardingData.industry` 等 6 個）。⚠️ 兩個踩坑教訓：**Firestore `update({'a.b': del})` 的點號是巢狀路徑不是字面欄位名**（誤刪真值，已還原，要刪字面欄位須用 `new FieldPath('a.b')`）；**React 18 StrictMode dev 雙跑下「ref 守衛 + cleanup 退訂」會導致沒有任何監聽器**（頁面永遠停在載入中，build 三關驗不出來，只有實際開頁才會發現）。端到端驗證：清空 D67 goal → 走完問卷 → 值寫回 `conversion` | （本次） |
| 2026-08-09 | **粉專切換選單分類（folder，純顯示）**：owner 同時管理 8 個粉專（5 個 TM 分會 + 3 個個人品牌），下拉選單平鋪難找。新增 `lib/pages/pageFolders.ts`（`groupPages()` 純函式 + `normalizeFolders()` 防禦性收斂）與共用 `components/PageOptions.tsx`（`<optgroup>` 渲染）；`/api/pages` 回傳一併帶 `folders`（不增加請求數，`tokensOnly` 分支刻意不帶——連接頁是跨頁隔離敏感面）；6 個儀表板頁套用（5 個原生 select 走 PageOptions，廣告頁自訂 div 選單另做分隔標題）。資料存 `users/{uid}/settings/pageFolders`，**per-user 偏好，完全不影響權限**。⚠️ **刻意命名為 folder 而非 group**：`docs/multi-tenant-rbac.md` §2.3 的 `groups/{groupId}` 是「批次授權」且**仍未實作**（`lib/auth/access.ts:91` 的 `TODO(Phase D)` 還在），若同名會被誤讀成 Stage D 做了一半——已在 §2.3 補警語。同時登記 owner 需求「邀請台灣總會以總會視角比較分會」到 §2.6：現況 `/dashboard/compare` 已能跨粉專比較但僅限自己 admin 的頁，要開放外部總會窗口才需 Stage D。無設定 UI（依 ROI 決定不做），分類由腳本寫入 | （本次） |
| 2026-08-09 | **「一鍵建立 FB 活動」可行性評估 → 否決（`docs/fb-event-creation-assessment.md`）**：Meta 官方文件原文顯示 Event 節點 **Creating/Updating/Deleting 三個操作皆「You can't perform this operation on this endpoint.」**，且 Limitations 明寫「Access to Events on Users and Pages is only available to **Facebook Marketing Partners**」——連讀取粉專活動都需 FMP 商業合作資格，**不是 App Review 能申請的權限**。另證：Page 節點 `Edge<Event>` 出現 0 次（對照組 `Edge<` 57 次，排除搜尋假陰性）、`page/events/` 與 `pages-api/events/` 文件皆 404。⚠️ `pages_events`／`instagram_manage_events` 是**廣告轉換事件回傳（CAPI）**，與活動管理無關，勿被名稱誤導。替代規劃（Slice A 活動素材包 / Slice B 宣傳排程模板）**評估後決定都不做**：活動頻率僅一年 2–3 次（約 10–15 則草稿、手動成本一年不到 1 小時），而 AI caption 與單則草稿排程（`draftStore.ts` `schedule.mode` + `functions/src/publishScheduled.ts`）**現在就有**，Slice A 不減少任何建立步驟、Slice B 不新增任何發布能力 → 投報率為負。重啟條件：活動變每月例會頻率或開始代操他人粉專。memory 新增 `project_fb_event_api_closed` | （評估文件） |
| 2026-08-09 | **Meta App 切 Live → FB Story／FB 影片解除限制**：832 通過 App Review 並切 Live mode，正式環境實測 API 發布的 FB 貼文一般觀眾看得到（原本 Development mode 下 FB Page Story 對非 App role 是黑畫面、FB 影片/Reel 完全不可見）。設定 `NEXT_PUBLIC_META_APP_LIVE=1`（本機 `.env.local` + Vercel Production/Preview），`lib/content/fbStoryFlag.ts` 的 `FB_STORY_ENABLED` 與 `FB_VIDEO_ENABLED` 同時轉 true → DraftComposer 的「Also post as Story」FB 選項開放、publishRunner 不再以 `FB_STORY_DISABLED_NOTE` 攔截 FB 限動、`FbCoverPicker` 封面圖 fallback 不再出現、DraftCard「補發 FB 限動」開放。**純環境變數，無程式改動**；要回退只需把該 env 設回 0/移除並 redeploy | （env-only） |
| 2026-08-06 | **FB 登入對外人「無法使用此功能」根因確認（非程式問題）**：832 送審過關並切 Live 後，外部使用者按「使用 Facebook 帳號登入」被擋，app admin 自己卻可以。真因＝Firebase Auth 的 FB provider 用的是 app **858（Contentloop Auth）**，其 `email`/`public_profile` 一直停在 App Review 的 **Not submitted**，從未取得 advanced access（**App 標 Published ≠ 權限上線**）；858 的 Data Use Checkup 也是當天才補做。判別法：錯誤畫面網址 `v8.0`＋中文＝Firebase(858)、`v19.0`＋英文＝自家 `/auth/connect`(832，`connect/page.tsx` 寫死 `locale: 'en_US'`）。**不可把 Firebase provider 改成 832**（832 是 Business 類型走 Login for Business，且 FB user ID per-app，換了既有 FB 登入者會變新 uid）。主流程 Google 登入→`/auth/connect`(832) 不受影響。附帶：landing footer 補「由 D67 Toastmasters 營運」+ 聯絡信箱（Meta Access Verification 要求網站顯示提供服務的企業資訊）。memory 新增 `project_fb_login_858_advanced_access` | `070dec8` |
| 2026-08-05 | **token-health 誤報修復（page 級告警）**：同一粉專常有兩份 token（owner + 舊 duplicate），daily sync 走 `collectionGroup` 疊代所有 token 寫 page-scoped 資料 → 任一有效 token 即持續更新。原本逐 token 告警，撞到失效的 duplicate 就每天開 GitHub issue（下游 `notifyTelegram`）+ email，但粉專其實正常（Legacy `235543696463178`）。改法：per-token flag 保留（各使用者 reconnect banner 準確），但 紅點/email/reportBug/appLevel 全改用 **page 級 `pageInvalid`**（只有零份有效 token 才告警、每頁一次）；`APP_LEVEL_THRESHOLD` 改數失效粉專數。驗證 `invalidTokens:1, invalidPages:0`；清掉 18 張誤報單（#31–#39, #43–#57 的 token 類） | `1ce6408` |
| 2026-08-05 | **classify-messages cron 逾時修復**：`/api/cron/classify-messages` 原本每頁×每區間完全序列跑（Meta 翻頁 + Gemini 分類），超過 Vercel 函式時限 → `504 FUNCTION_INVOCATION_TIMEOUT` → GitHub Actions workflow exit 1。改為 bounded 並發（4 worker）攤平 `(page,range)` tasks + 補 `maxDuration=300`；保留 30d/90d 兩區間。驗證：手動觸發 200、2m46s 完成（原 5m 逾時） | `04414f7` |
| 2026-07-25 | **廣告隔離熱路徑測試化 + 切頁 flash 修 + Budget 歷史**：(1) 抽出 `ads/sync` 的 `matchesPage`/`matchesIg` 為純函式（`lib/meta/pageIsolation`：`matchesPageStory`/`matchesIgStory`/`creativeBelongsToPage`）+ 16 vitest（含 igUserId 分支 + 雙粉專隔離 fixture）——route 保留薄封裝、行為等價。(2) 修切換粉專時診斷卡跨頁 flash（`handlePageSwitch` 立即清 adData/aiDiagCards，無資料污染純視覺）。(3) Budget 模擬器比照 Creative Ranking 依日期撈歷史廣告組合，抽共用 hook `useHistoricalCreatives`（兩端共用、無新後端；歷史 adset 預算為花費估算）。(4) skill 庫 fresh-context 複審後套用 6 個 IMPORTANT 修正 | `f3656e5` `74990eb` `3322b63` `7f97dab` |
| 2026-07-23 | **自主路徑護欄（稽核 C，roadmap 全交付）**：(C1) `lib/usage.isOverMonthlyClaudeCap()` 加總本月**全域** `claudeCostUsd`（collectionGroup），達上限（env `ANTHROPIC_MONTHLY_CAP_USD` 預設 30 USD）→ 診斷 agent 跳過 sonnet tool loop、走 haiku 單發（recordAgentHealth 記 `cappedToHaiku`）。(C2) `apps/ops-bot` `/build` 限 owner（env `TELEGRAM_BUILD_OWNER_IDS`，Telegram 數字 id；未設 fallback 到完整白名單）——生效需在 Railway 設該 env 並重部署 ops-bot | `54b6c33` `9f30037` |
| 2026-07-23 | **診斷 agent 記帳（稽核 B3，批次 B 完成）**：`lib/usage.ts` 新增共用 `recordClaudeUsage(uid, {model,inputTokens,outputTokens})`，寫進成本頁 + admin 統計都在讀的 `users/{uid}/usage/{month}`（+ `byModel` 分模型 token 明細）；sidekick 改用它。診斷 agent 的 sonnet tool loop 改 iterate runner 累加**跨 tool 回合** usage（原 await 只拿最後一回合會少算）+ haiku fallback + eval 重試全部記帳，歸屬到 page owner uid（`resolvePageOwnerUid`）——診斷成本以前完全沒進成本頁。`console.info` 記 tool loop 回合數 + parse 成功與否 | `476d699` |
| 2026-07-23 | **收靜默 fallback（稽核 B2）+ FB 登入連結修復**：(1) `diagnosisAgentServer` sonnet/haiku catch 加 `console.error`、orchestrator 記 sonnet→haiku 退回並寫健康 counter `agentHealth/diagnosis`（量化 sonnet 路徑退化頻率）；`bugReporter` 4 個靜默 catch 加 log（Issue 建立失敗/主 catch=error）——仍維持 reportBug 永不 throw。(2) FB 登入撞 Google 帳號改「使用者點擊按鈕」觸發連結（原自動 popup 被手機瀏覽器擋成靜默失敗）+ popup-blocked/closed 明確提示 | `77684d6` `e6eb29e` |
| 2026-07-23 | **Creative Ranking 依日期區間撈歷史素材 + ads token 失效顯性化**：(1) 新增唯讀路由 `GET /api/ads/creatives`（用呼叫者 token 即時打 Meta ads `time_range`、完整 story-id fallback chain＋`belongsToAnyPrefix` 頁隔離、`mapRawAdCreative` 產出、**絕不寫 Firestore**）；`CreativeSection` 在區間起點 >30 天前時自動改撈歷史（含全狀態素材、loading＋歷史提示＋差異化空狀態），近 30 天維持快照。根因＝`adInsights/latest` 是近 30 天滾動窗口，看不到更早素材。(2) `/api/ads/sync` 遇 auth 錯誤改 `markTokenStatus(invalid)`＋回 401（不再靜默 $0），對應 Issue #43 token 營運事故。(3) `bug-fix-agent.yml` `checkout`/`setup-node` v4→v5 消 Node 20 警告 | `c5d3343` `2395157` `2c7b30c` |
| 2026-07-21 | **Harness 稽核批次 A + B1 測試框架**：(A) `skills-staging` 14 支 skill 促正式→`.claude/skills/`；`architecture.md` 修正式重寫（page-scoped 為主）；`AGENTS.md` 加 gitignore；文件漂移修正。(B1) 導入 vitest（repo 首個測試框架）＋47 純函式測試（page-isolation 前綴/`validateDraft`/`diagnosis` 門檻）；抽 `lib/meta/pageIsolation.ts` 接入 2 個 live 點 | `e7a7f49` `63bdc46` |
| 2026-07-20 | **App Review 第一輪整批退件（Policy 1.6）→ 重送計畫**：`docs/meta-app-review.md` 新增第 8 節（退件分析：審查員用自己測試帳號、只看 screencast，不需提供 FB 帳密；`ads_read` 說明複製貼上錯誤）＋第 9 節（Threads 獨立送審）。**重送組合＝現有 SCOPES 12 個一次全送**（8 核心讀取＋`business_management`＋私訊 `instagram_manage_messages`/`pages_messaging`＋發布 `pages_manage_posts`/`instagram_content_publish`），不動 code 使同意畫面與清單一致；私訊×2＋`business_management` 需企業驗證（高風險，逐權限判定）。附 12 則英文用途說明；拍攝腳本獨立成 `docs/meta-app-review-screencast-script.md`（13 幕）。隱私政策/資料刪除頁同步涵蓋。memory 同步更新 | (文件) |
| 2026-07-15 | **每日 Meta Token 健康檢查 cron**：`app/api/cron/token-health`（掃 `collectionGroup('metaTokens')` 所有 token→探測 `/{pageId}?fields=name`→失效者標 `tokenValid:false`＋發紅點（owner+super-admin，每日冪等）＋餵 `reportBug`＋email digest；健康 token 自癒標回 valid；只認 OAuthException、暫時性錯誤 skip；≥3 個同時失效→升級 critical「疑似 App 層級」）＋ `.github/workflows/token-health.yml`（每日台灣 06:30，用既有 `CRON_SECRET`）＋ `superAdminUids()`。實測 11 token 抓出 2 失效 | (本 commit) |
| 2026-07-15 | **Token 失效顯性化 + 連接頁隔離**：新增 `lib/meta/tokenError.ts`（偵測需重授權的 OAuthException→把 `tokenValid` 寫回 `metaTokens/{pageId}`，成功則自癒）；`fb/sync`、`ig/sync` 偵測失效→回 `tokenInvalid`；儀表板顯示紅色 banner，依 `canReconnect`（是否為 token 擁有者）決定顯示「重新授權」按鈕或「請通知該粉專 FB 管理員」提示；`/api/pages` 新增 `tokensOnly` 模式→連接頁只列使用者自己 OAuth 連接的粉專（修 super-admin 授權頁洩漏其他粉專名稱）。根因＝Chill Hi High token 失效（OAuthException code 200）致同步靜默停擺（見 memory `project_token_invalid_silent_sync`）。待做：每日 token 健康檢查 cron | (本 commit) |
| 2026-07-12 | **Slice 20 — 發文文案學習迴圈**：AI 文案發布=採納訊號（publishRunner→sidekickFeedback）；每日 cron 7 天後比對貼文互動＋觸及 vs 同粉專近 20 篇基準（任一 ≥1.2× 即驗證有效）；草稿文案 few-shot 升級品質加權（驗證有效的 AI 文案優先）。純人類＋數據訊號、不經 LLM 評審 | (本 commit) |
| 2026-07-12 | 診斷卡低分重試升級 tool loop：evaluator 扣分理由回灌 + agent 重查數據（sonnet，4 輪上限＋25s timeout，超時退回 haiku 單發）；另 AI Bug 回報獨立成頁 `/dashboard/admin/bugs`（頭像選單入口，super-admin）＋ AI 修復 PR 流程定案「分支拉 localhost 驗收 → 人工 merge → Vercel」（見 memory `feedback_deploy_flow`） | (本 commit) |
| 2026-07-12 | **Phase 3B Slice 19 — AI Bug 修復 agent（Phase 3B 完結）**：`bug-fix-agent.yml`（人工 workflow_dispatch 觸發）＋ `scripts/bug-fix-agent.mjs`（Claude Agent SDK）。agent 只改檔案，branch/commit/PR 由 workflow 執行；保護路徑防護、CI tsc+eslint、Vercel preview 三道驗證；無 merge 權限（雙重 HITL）。需 Actions secret `ANTHROPIC_API_KEY` | (本 commit) |
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
