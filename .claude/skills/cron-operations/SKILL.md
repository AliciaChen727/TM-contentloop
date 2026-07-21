---
name: cron-operations
description: 載入時機（觀察到的狀態）：要手動觸發/排錯任何排程任務、cron 回 401、資料「要等明天才會更新」想立刻重建、或要新增一條排程。
---

# Cron 營運（驗證日 2026-07-13）

## 排程清單（.github/workflows/，全部打正式站 Vercel）
| Workflow | 排程（UTC） | 台北 | 打的端點 |
|---|---|---|---|
| daily-sync | `0 19 * * *` | 03:00 | `/api/cron/sync`（FB/IG/Threads 貼文＋廣告＋merge＋診斷＋IG 粉絲樣貌） |
| stories-sync | `0 */4 * * *` | 每 4 小時 | `/api/cron/sync-stories` |
| alert-scheduler | `0 * * * *` | 每小時 | `/api/cron/send-alerts`（排程 gate 在 route 內：星期/小時/每日一次） |
| classify-messages | `30 */6 * * *` | 每 6 小時 | `/api/cron/classify-messages` |
| eval-rescore | `30 5 * * *` | 13:30 | `/api/cron/eval-rescore`（學習迴圈每日批次） |
| self-learning-health | `0 0 1 * *` | 每月 1 號 | `/api/cron/self-learning-health`（有問題才寄信） |
| bug-fix-agent | 無排程 | — | workflow_dispatch 手動（見 bug-pipeline-and-fix-agent.md） |
另：`/api/cron/publish-scheduled` 由 Vercel cron 或發布排程觸發（草稿排程發布）。

## 手動觸發（三種方式）
1. **GitHub UI**：Actions → 選 workflow → Run workflow（全部都有 workflow_dispatch）。
2. **直打正式站**：`Authorization: Bearer $CRON_SECRET` POST 該端點。
3. **打本機**（測未部署的改動）：dev server 起著，POST `http://localhost:3000/api/cron/...`，同一個 secret。

## 事故：CRON_SECRET 401（2026-07-12 浪費過一輪）
`.env.local` 裡 `CRON_SECRET="..."` **帶引號** — 用 `grep|cut` 抽值會連引號一起抽出 → 401。正確抽法：
```bash
grep "^CRON_SECRET=" apps/web/.env.local | cut -d= -f2- | tr -d '"' | tr -d '\n'
```
本機與正式站的 CRON_SECRET 是**同一個值**（驗證日 2026-07-12）。401 時先懷疑引號/換行，再懷疑值不同。

## daily-sync 的 ads 段語意（排錯必知）
1. 每個 admin × 每頁跑 `syncAdsForUser`：掃**所有**可見廣告帳號 → 每帳號頁過濾切片 → 寫 `adAccountSnapshots/{act_id}`；帳號無本頁廣告 → **刪**該 snapshot（自癒）。
2. `mergePageAdInsights`：合併 snapshots（忽略 >14 天）→ 寫共享 `pages/{pid}/adInsights/latest`；**集合全空 = 肯定無廣告 → 歸零重寫**（同步失敗不會刪 snapshot，所以 token 壞不會誤觸歸零）。
3. merge 觸發條件是「該頁 ads 同步**成功**」（含 pageAdsCount 0）— 不是「有 adAccountId」。改這個條件曾讓髒資料清不掉（2eb643a）。
4. 殭屍偵測：merge 後 dateRange 起點 >45 天 → critical bug report。

## 新增排程的規範
複製既有 yml（curl + `secrets.CRON_SECRET` + HTTP status 檢查 + workflow_dispatch）；route 端驗 `Authorization` 對 `process.env.CRON_SECRET`；長任務設 `maxDuration`（eval-rescore 用 300，一般 60）。

**Done 定義**（排錯一輪後）：手動觸發回 200、目標 Firestore doc 的 `syncedAt` 更新、儀表板反映新資料。

再驗證：`grep -l 'workflow_dispatch' /Users/pei-wenchen/Files/TM-contentloop/.github/workflows/*.yml | wc -l`（應為 7）
