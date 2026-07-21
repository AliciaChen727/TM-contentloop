---
name: agents-tooling-contract
description: 載入時機（觀察到的狀態）：要新增/修改任何 AI agent 或工具、要決定新能力該用哪種 runtime、Sidekick 回覆解析失敗或主動提及別的粉專、或 agent 引用了不存在的數字。
---

# Agent 與工具契約（驗證日 2026-07-13）

## Runtime 分工（Phase 3B 核心決策，別混用）
| 類型 | 技術 | 跑在哪 | 用於 |
|---|---|---|---|
| 資料分析 agent | `@anthropic-ai/sdk` 的 `client.beta.messages.toolRunner` + `betaTool`（raw JSON schema，無 zod） | Vercel serverless | Sidekick、診斷批次 |
| 修 code agent | `@anthropic-ai/claude-agent-sdk` 的 `query()` | **只在 GitHub Actions**（Vercel 跑不動：需 spawn process） | Bug 修復（scripts/bug-fix-agent.mjs） |
新 agent 先問「跑在哪」再選 runtime。Agent SDK 在 Vercel 起不來，Tool Runner 沒有檔案工具 — 選錯邊都是死路。

## 工具層（`lib/ai/tools/pageDataTools.ts`）— 四工具 + 三防線
工具：`get_ad_insights`（快照+趨勢+90天投放貼文）、`get_posts`（自然貼文）、`get_feedback_memory`（學習記憶）、`compare_pages`（跨頁，僅白名單≥2 時提供）。
1. **白名單**：`ToolContext.allowedPageIds` 由 server 端 `resolveAllowedPages(uid)` 解析（metaTokens + viewerAccess，含 `access: admin|viewer`）— 絕不信 client/model 給的 pageId。
2. **唯讀**：工具無任何 Firestore 寫入。
3. **guard**：工具意外失敗 → `reportBug`（fire-and-forget）＋回模型優雅錯誤字串，對話不炸。
**新工具必須同樣套白名單檢查與 guard 包裝** — 這不是風格，是隔離契約的執行層。

## 資料語意跟著資料走（本 repo 特有教訓）
工具回傳內嵌 `summaryCaveat`/`note` 字串（「近30天窗口、$0≠異常、提貼文用 text+url 別念 postId、歷史比較用 promoted90d」）。**為什麼**：只放 system prompt 時模型多次誤讀（把 $0 說成同步異常、對使用者念 raw postId、拿 30 天數據回答 90 天問題 — 三個都真實發生）。改工具回傳結構時，語意說明要同步更新。

## Sidekick 契約（`app/api/ai/sidekick/route.ts`）
- 模型 claude-sonnet-4-6、`max_iterations: 5`（互動延遲預算）、`maxDuration = 60`。
- **回覆是嚴格 JSON 物件**（type/summary/bullets/stats/actions/…）— UI 靠它渲染。解析鏈：直接 parse → 正則抽 `{...}` → 降級 general 回覆。**最終答案取最後一個 text block**（工具呼叫間可能有 inter-tool 筆記）。
- **範圍鐵則**（2026-07-11 使用者回饋後加）：只分析當前 `pageId` 的粉專；其他授權粉專**只有**使用者明確點名或明確要求比較才能提及。復發症狀＝回答 A 粉專問題時主動帶入 B 粉專數據。
- 互斥規則：image/video_request 時 bullets/actions 必空；route 有 defensive strip 兜底。
- Token 用量跨迭代累加寫 `usage`（別只記最後一輪）。

## 診斷批次 agent
白名單鎖單頁 `[pageId]`、max 6 輪、無人等待所以可較慢；輸出仍過 `parseAndEnforceCards` 強制層（見 diagnosis-engine-contract.md）。

## 模型指派（改前先查 CLAUDE.md「使用的 Model」段）
sonnet-4-6：Sidekick、洞察報告、診斷 tool loop。haiku-4-5-20251001：素材生成、診斷 fallback、bug 分類、evaluator fallback。gemini-2.5-flash：評審主判。gemini-embedding-001：檢索。

- ❌ 反例（觀察到的合理化）：「白名單已經擋住越權了，把全部授權粉專列給模型讓它自由查，回答會更全面」— 2026-07-11 實測：模型立刻在單頁問題裡主動分析別頁。權限邊界（白名單）與行為邊界（範圍鐵則）是兩層，都要。

再驗證：`grep -n "max_iterations" apps/web/app/api/ai/sidekick/route.ts apps/web/lib/ads/diagnosisAgentServer.ts | head -4`
