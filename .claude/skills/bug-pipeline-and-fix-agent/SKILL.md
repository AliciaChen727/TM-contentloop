---
name: bug-pipeline-and-fix-agent
description: 載入時機（觀察到的狀態）：要在某段 code 加異常偵測、bug 通知重複/沒出現、要操作或修改 AI 修復 agent（bug-fix-agent workflow）、或修復 PR 開出來後不知道下一步。
---

# Bug 回報與修復 Agent（驗證日 2026-07-13）

## 回報鏈（Slice 18）
```
偵測點 → reportBug() → bugReports/{bug__{fp}__{date}}（同日冪等：source+title hash）
                     → 鈴鐺通知 SUPER_ADMIN_UIDS → GitHub Issue（label: bug, ai-reported）
```
- 核心：`lib/bugs/bugReporter.ts`。severity 省略時由 haiku 分類（fallback 'warning'）；分類含一句給非工程師的繁中摘要。
- **絕不自動修** — 這是設計原則不是缺陷。`reportBug` 永不 throw（回報失敗不能弄掛主流程）。
- 現有偵測點：cron 殭屍快照（>45 天，critical）、Sidekick 四工具 guard、publishRunner 失敗/例外。
- **新偵測點的規範**：fire-and-forget（`.catch(() => {})`）、title 穩定（進去重指紋，別帶時間戳/隨機值）、context 只放 JSON-serializable。
- 查看：`/dashboard/admin/bugs`（super-admin）、鈴鐺、GitHub Issues（filter `ai-reported`）。
- 去重語意：同 source+title 同日只通知一次、只開一張 Issue，重複只 `count++`。「通知沒出現」先查是不是被去重了（`bugReports` 裡 count >1）。

## 修復鏈（Slice 19）— 雙重人工關卡
```
關卡1: 人在 GitHub Actions 按 Run workflow（輸入 Issue 編號）
  → scripts/bug-fix-agent.mjs（Claude Agent SDK, sonnet, 載入 CLAUDE.md, maxTurns 80）
  → agent 只改檔案（被明文禁止跑 git）
  → workflow 守門: 無修改→fail；動到 .github/workflows/ 或 agent 腳本本身→拒開 PR
  → tsc + eslint（改過的檔）→ 開 PR（branch ai-fix/issue-{N}-{run_id}）
關卡2: 分支拉到本機 localhost 驗收 → 使用者按 Merge → Vercel 部署
```
- workflow：`.github/workflows/bug-fix-agent.yml`，`concurrency: bug-fix-agent`（同時只跑一個）、timeout 30 分。
- 需要：repo Actions secret `ANTHROPIC_API_KEY` ＋ Settings→Actions 勾「Allow GitHub Actions to create and approve pull requests」。
- agent 的硬性規則寫在腳本 prompt 裡：最小 diff、不加依賴、判斷不能安全修就**什麼都不改**（→ workflow fail 並留原因，這是正常結束不是 bug）。
- PR 驗收流程 = validation-and-qa.md 的 AI 修復 PR 規則（localhost 關卡）。

## 安全模型（改 workflow 前必懂）
merge 權限**不存在**於任何自動化：workflow token 只能開 PR。保護路徑檢查防 agent 自我修改。`package-lock.json` 被排除出 diff（npm install 副產物）。**任何「讓 agent 自動 merge / 自動部署」的提案都違反本 repo 的 HITL 契約** — 使用者明文要求過兩道關卡。

- ✅ 正例：發布失敗 → 鈴鐺看到 → 點 Issue 看細節 → 判斷值得修 → Run workflow → PR → 本機驗收 → merge。
- ❌ 反例（觀察到的合理化）：「這 bug 很小，讓修復 agent 直接 push main 省一輪」— 不存在這條路；agent 沒有 push main 的權限設計，繞過它需要改 workflow 權限，而那正是保護路徑檢查要擋的事。

再驗證：`grep -n "concurrency\|ai-fix/issue" /Users/pei-wenchen/Files/TM-contentloop/.github/workflows/bug-fix-agent.yml | head -3`
