---
name: auto-publish-agent
description: 在 ContentLoop 開發「Agent 自動發布貼文/廣告」功能時載入。編碼 human-in-the-loop 關卡、fallback 鐵則、發布狀態機、各平台尺寸/字數硬限、裝置感知 creative 與檔案位置。動到草稿/發布/Meta 寫入相關程式前必讀。
---

# Agent 自動發布 — 開發技能

單一事實來源：`docs/agent-auto-publish-plan.md`。本技能是「動手時的鐵則卡」，改草稿/發布/Meta 寫入相關程式前先套用。

## 已拍板方向（不要自作主張改）
- **L1 草稿 + 人工核准**：Agent 生成 → 存 `draft` → Admin 核准才發。預設絕不自動發布。
- **先貼文、後廣告**：貼文（可刪、低風險）先跑通迴圈；廣告（Phase 4，動真錢）永遠停在 L1，每筆人審。
- **先做草稿 UI（零 Meta 風險），並行送 App Review**；權限過了才接寫入。
- **Threads 是先鋒**：獨立 API（`graph.threads.net`），發自己帳號，`threads_content_publish` 多半免 FB/IG App Review → S4a 最快跑通端到端。

## 不可違反的鐵則
1. **HITL 強制關卡**：草稿預設 `draft`，未經 Admin 核准絕不寫任何平台。破壞性操作（刪/暫停/改預算）一律不自動化。
2. **Fallback 不靜默**：LLM 生成失敗 → 留 `failed` 草稿 + 通知，系統不亂發；Meta 寫入失敗 → 退避 retry → 仍敗標 `failed` + 存 error + 通知，絕不吞錯。
3. **狀態機唯一**：狀態轉移只能走 `lib/content/draftTypes.ts` 的 `DRAFT_TRANSITIONS`／`canTransition`，非法轉移在 `draftStore.transitionDraft` 回 409。發布側狀態（publishing/processing/published/failed）由发布流程設，**不可**由審核 UI 設（route 只放行 `HUMAN_DRIVEN_STATUSES`）。
4. **跨頁隔離**：草稿一律 page-scoped `pages/{pageId}/contentDrafts/{id}`；讀寫都要 `canManage`（owner/admin/superadmin，**viewer 看不到草稿**）。遵守 CLAUDE.md 隔離清單，雙粉專交叉測試。
5. **平台硬限＝驗證擋下**（S3 `lib/publish/validateDraft.ts`，尚未建）：任一目標平台超限就擋，不硬送。

## 發布狀態機
```
draft → approved | rejected | expired
approved → scheduled | publishing | draft(收回核准) | rejected | expired
publishing → processing | published | failed
processing → published | failed
published（終態）
failed | rejected | expired → draft（可復原重審）
```

## 各平台硬限（`lib/publish/platformSpecs.ts`，待建；數字見 plan §5.5）
- **Threads**：單則 500 字，但**超過不擋** → 用 `lib/publish/threadsSplit.ts` 的 `splitForThreads()` 自動切成「主貼 + 留言串」（發布時第 1 段為主貼，其餘用 `reply_to_id` 串成回覆）。圖片最大寬 1440、≤10 張；影片 ≤5 分；純文字可（`media_type=TEXT`）。兩步發布：建容器 `/{tid}/threads` → `/{tid}/threads_publish`。
- **Instagram**：caption 2,200；**#hashtag ≤30**；動態影片一律 Reels（`media_type=REELS`，9:16，≤15 分）；Story 用 `STORIES`。
- **Facebook**：文字無硬限但最佳 40–80 字；Reels 走獨立端點 `/{page}/video_reels`（resumable upload）。
- **影片/Reels 非同步**：建容器後**輪詢 `status_code`（IN_PROGRESS→FINISHED）才 publish**；草稿走 `processing` 態，逾時/ERROR → `failed`+通知。素材需公開 URL。

## 裝置感知 creative（串已完成的 deviceBreakdown）
- 用廣告 `impression_device`（`data.deviceBreakdown`）判受眾主力裝置：手機為主 → 直式 4:5 / 9:16 + 短文大字；平板/桌機高 → 方形/橫式可、文字可長。無廣告資料 → 預設「手機為主」。
- **建議非強制**：寫進 `generated.recommendation`，人審看得到理由，仍可自改。

## 檔案地圖
- 型別 + 狀態機：`lib/content/draftTypes.ts`
- Store（page-scoped CRUD）：`lib/content/draftStore.ts`
- API：`app/api/content-drafts/route.ts`（POST 建立 / GET 列出）、`app/api/content-drafts/[id]/route.ts`（GET / PATCH 狀態·編輯）
- 審核 UI：`app/dashboard/content-drafts/page.tsx` + `components/content/DraftCard.tsx` + `DraftComposer.tsx`
- 生成端（可復用）：`app/api/ai/creative`（文案+圖）、`app/api/ai/image`、`app/api/ai/video`
- Threads 連接/scope：`app/api/auth/threads/authorize/route.ts`（現 `threads_basic,threads_manage_insights`；發布需加 `threads_content_publish`）

## 里程碑進度
- [x] S1 草稿基建（型別/狀態機/store/API，已對 Firestore 驗證）
- [x] S2 審核 UI（列表/分頁/核准·拒絕·編輯/composer）
- [~] S3 進行中：`platformSpecs` + `validateDraft`（字數/hashtag/媒體硬限，composer 標紅擋存 + create API 422 守門）+ 稽核 log（`pages/{pageId}/publishAuditLog`）已完成。**待補**：killSwitch/automationSettings（發布端總開關，等 S4/S5）、禁詞 per-page 設定 UI（機制已在 `validateDraft` 的 `bannedWords`）
- [ ] S4a Threads 發布（先鋒）→ S4b FB/IG 發布（等 App Review）
- [ ] S5 排程（L2）→ S6 廣告寫入（Phase 4）→ S7 學習迴圈

## 每片交付紀律
`tsc --noEmit` + `eslint` + `next build` 三關全綠 → localhost 給使用者測 → 回 OK 才 commit+push。build 前先停 dev（避免污染 .next）。純文件改動可豁免 localhost。
