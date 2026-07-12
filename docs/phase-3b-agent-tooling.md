# Phase 3B — Agent 工具化升級（自查資料、跨粉專比較、自我檢查、Bug 回報/修復）

> **定位**：Phase 3（自我學習迴圈，已完成 Slices 8–14）的延伸。把三個既有「單次呼叫」系統升級為**能呼叫工具的 agent**，並新增 bug 回報→人工核准→修復的 pipeline。
> **決策日期**：2026-07-11（使用者已確認方向、模型升 sonnet、slice 順序、跨粉專總覽獨立頁）。

## 1. 現況（2026-07-11 調查）

| 系統 | 現況 | LLM |
|---|---|---|
| 自動發文 | `lib/content/publishRunner.ts` 純編排，無 LLM | 無 |
| AI Sidekick | `app/api/ai/sidekick/route.ts` 單次呼叫，context 全部預先查好塞 prompt | claude-sonnet-4-6 |
| 診斷批次 | `lib/ads/diagnosisAgentServer.ts` 單次呼叫 + Gemini evaluator 重試一次 | claude-haiku-4-5 |

三者皆無 tool use、無多步推理；Firestore 存取都在 LLM 呼叫前後，模型不能自己決定查什麼。

## 2. 核心架構決策（ADR）

**兩種 runtime，各司其職：**

| 類型 | 技術 | 跑在哪 | 用於 |
|---|---|---|---|
| 資料分析型 agent | `@anthropic-ai/sdk` **Tool Runner**（`client.beta.messages.toolRunner` + `betaTool`，raw JSON schema，不加 zod 依賴） | Vercel serverless（現有 API routes / cron） | 診斷批次、Sidekick、跨粉專比較 |
| 修 code 型 agent | `@anthropic-ai/claude-agent-sdk`（Claude Code harness） | **GitHub Actions**（Vercel 跑不動：需 spawn process + repo 檔案系統） | Bug 修復 agent |

延續 Phase 3 §5 ADR：不引入 LangGraph/LangChain；observability 先自建 logging。

## 3. 隔離鐵則在工具層的落實（必讀）

所有 Firestore 工具的執行器共用一個 context：

```ts
interface ToolContext { allowedPageIds: string[] }  // server 端解析，模型碰不到
```

- 白名單由 server 從呼叫者身分解析（admin 查 `metaTokens/{pageId}`、viewer 查 `viewerAccess`），**不接受模型或 client 傳入的任意 pageId**。
- 工具執行器逐一驗證參數中的 pageId ∈ 白名單，違者回 tool error（不 throw、不洩漏其他粉專存在與否）。
- 跨粉專比較 = 同一 admin 名下多粉專的**明示**分析：輸出標明為跨頁結果、絕不寫回任何單一粉專的快照（`adInsights/latest` 等）。
- 診斷批次（cron per page）：白名單 = `[pageId]` 單元素，天然隔離。

## 4. 五個能力 → 設計

### 4.1 Firestore 工具層 `lib/ai/tools/`
- `get_ad_insights(pageId, dateRange?)` — 讀 `pages/{pageId}/adInsights`（latest + 歷史快照趨勢）
- `get_posts(pageId, platform, limit)` — 讀 page-scoped `fbPosts`/`igPosts`（遵守 legacy filter 規則）
- `get_feedback_memory(pageId, source?, alertType?)` — 讀 `sidekickFeedback`
- `compare_pages(pageIds, metric, dateRange?)` — 跨粉專聚合（pageIds ⊆ 白名單）

### 4.2 跨粉專比較
- 工具層見上；入口有二：**Sidekick 對話**（白名單 >1 時開放 `compare_pages`）+ **獨立「跨粉專總覽」儀表板頁**（Slice 17）。
- 儀表板頁走 BFF：新 API route 解析白名單 → agent loop → 回比較結果卡片；頁面掛 `<AiSidekick pageId={...} contextPage="compare">`。

### 4.3 多步推理 + 多輪自我檢查
- **診斷批次**（無人等待）：tool loop 上限 ~15 次工具呼叫；system prompt 要求最終輸出前用工具**核對引用數字**；Gemini evaluator 保留為第二道防線。模型升 **claude-sonnet-4-6**（haiku 對多步工具推理較弱；與 Sidekick 同款、專案慣例）。
- **Sidekick**（互動）：開放工具、上限 ~5 次呼叫；不做多輪自我批判（延遲考量）。

### 4.4 Bug 偵測 + 回報
- 非巡邏 agent；掛在既有 agent 執行路徑的**結構化捕捉**：工具執行錯誤、資料不一致、發布異常模式。
- 寫 `bugReports/{id}`（現象/context/嚴重度/log）→ Phase 2 通知（鈴鐺+email）→ 開 GitHub Issue（給修復 agent）。
- 分類與摘要用一次 claude-haiku-4-5（便宜）。

### 4.5 Bug 修復 agent（雙重 HITL）
```
bug 回報 → 通知 ──[關卡1: 使用者按「請 AI 修復」]──→ GitHub Actions
Agent SDK：讀 issue → 改 code → tsc/eslint/build 三關 → 開 PR（無 merge 權限，硬性防線）
──[關卡2: 使用者 review PR 才 merge]──→ Vercel 部署
```

## 5. Vertical Slices（一次一片，三關全綠才 commit）

- [x] **Slice 15** — `lib/ai/tools/` 工具層 + 白名單隔離 + 診斷批次接 Tool Runner（模型升 sonnet；自我核數步驟）。(08a089f)
- [x] **Slice 16** — Sidekick 接工具（含 `compare_pages`，限 ~5 輪）＋當前粉專範圍鐵則＋貼文用內容+連結描述（禁 postId）＋`promoted90d`（90 天貼文層，歷史比較用）。(7929b09+)
- [x] **Slice 17** — 「跨粉專總覽」`/dashboard/compare`（admin-only，功能選單入口）：廣告表格＋全域日期篩選（30/90/自訂，套用表格與趨勢與貼文）＋粉專多選 chips＋素材趨勢圖（圖例：柱=花費/線=CTR）＋廣告受眾＋**IG 粉絲樣貌**（`follower_demographics`，cron 每日寫 `igFollowerDemographics`）＋貼文比較；內容儀表板加 `IgAudienceCard`（成效趨勢下方，`/api/pages/ig-audience` 逐頁驗權）。
  - 附帶修復：cron 跨頁污染（見 memory `project_cron_ads_page_filter`）；manual sync shared 寫入原以「有 ACTIVE 素材」為條件 → 已結束戰役的趨勢/受眾永遠進不了共享快照，改為任何頁匹配素材即寫。
  - 已知限制：Meta 無「貼文層」受眾 API；FB 粉專年齡性別分佈已被 Meta 移除 → 自然受眾以 IG 帳號層為準。
- [x] **Slice 18** — Bug 回報 pipeline：`lib/bugs/bugReporter.ts`（`reportBug()`：haiku 分類嚴重度＋繁中摘要 → `bugReports/{id}` 同日冪等 → 鈴鐺通知 super-admin → GitHub Issue，需 env `GITHUB_BUG_TOKEN`／repo 由 `GITHUB_BUG_REPO` 覆寫）。偵測點：① cron 殭屍快照（合併後 dateRange 起點 >45 天 = 跨頁污染訊號，critical）② Sidekick 四工具 guard（未預期錯誤→回報＋優雅 tool error）③ publishRunner 發布失敗/例外。**只回報、絕不自動修**。E2E 已驗證（含 Issue #28 開立/關閉）。
- [x] **Slice 20** — 發文文案學習迴圈：發布成功＝採納訊號（`publishRunner` 寫 `sidekickFeedback` `source:'draft'`，每草稿×平台冪等）→ 每日 `eval-rescore` 專屬分支（**不經 LLM 評審、不進 qualityStats**）：7 天後比對該貼文互動＋觸及 vs 同粉專近 20 篇基準（各 +1 平滑），**任一 ratio ≥ 1.2 → `recommendToFewShot`** → `historyExamples.fetchTopPostExamples` 驗證有效文案優先、觸及排序補位（去重）。Threads 暫標 inconclusive；門檻 1.2 為保守起步值。E2E 已用真實貼文驗證（負案例正確被擋）。
- [x] **Slice 19** — Bug 修復 agent：`.github/workflows/bug-fix-agent.yml`（`workflow_dispatch` 輸入 Issue 編號）＋ `scripts/bug-fix-agent.mjs`（Claude Agent SDK `query()`，sonnet，載入 CLAUDE.md）。安全設計：**agent 只改檔案**，git branch/commit/PR 由 workflow 決定性執行；保護路徑（workflows/agent 腳本）被動到即拒開 PR；無修改（agent 判斷不能安全修）= fail；CI 跑 tsc + eslint、Vercel preview build 為第三道驗證；agent **無 merge 權限**。雙重 HITL：關卡1=人工觸發 workflow、關卡2=人工 review PR。需 repo Actions secret `ANTHROPIC_API_KEY` + Settings→Actions 勾「Allow GitHub Actions to create and approve pull requests」。Issue/鈴鐺通知內含觸發指引。

## 6. 開放問題
- 跨粉專總覽頁的路由名（暫定 `/dashboard/compare`）與比較維度（CTR/CPC/觸及/互動率？）。
- 診斷批次 tool loop 的 token 成本監控（沿用既有 usage logging）。
- Slice 19 的 GitHub Actions 觸發方式：dashboard 按鈕 → repo_dispatch？或 GitHub issue label 觸發？（做到該 slice 再定）
