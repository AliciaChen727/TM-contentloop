---
name: debugging-fb-engagement
description: 載入時機（觀察到的狀態）：FB 貼文的按讚/留言/分享顯示 0 或整批歸零、FB「觸及」全 0、新貼文互動卡 0 不動、或 per-post insights 呼叫回 #100 錯誤。此症狀復發過三次，每次根因都不同 — 別套上次的解法。
---

# FB 互動/觸及歸零 Playbook（驗證日 2026-07-13）

## 三次復發史（依時間）— 先分辨你面對的是哪一種
1. **同步覆寫真值**（修復 fb1f422 前後）：同步端 `?? 0` 把已存在的真值蓋成 0。解法＝read-then-max（先讀舊值、取 max 再寫）。**症狀**：舊貼文的數字時有時無。
2. **read-then-max 護不了新貼文**（2026-07-04 根治）：新貼文無前值可 max，而 cron 當時從不可靠的 `/insights` metrics 取互動 → 新貼文卡 0。解法＝互動改讀 `/posts` 的 plain fields（reactions/comments/shares summary），`/insights` **只**用來拿觸及。**症狀**：只有新貼文 0，舊貼文正常。
3. **Meta 下架 metric**（2026-06-15，Meta 全 API 版本）：`post_impressions_*` 家族整組移除 → 回 #100 "not a valid insights metric"，舊 code 靜默吞錯 → 觸及卡 0 數月。解法＝改用 `post_media_view`（貼文層）/`page_media_view`（粉專層）。**注意**：這是 views（可超過 unique reach），貼文層已無 unique 變體 — UI 文案不要寫「不重複觸及」。

## 觸發 → 步驟
1. 分辨症狀屬於上面哪型（舊貼文抖動＝1、僅新貼文＝2、觸及全 0＋log 有 #100＝3、或新型）。
2. 看 `app/api/cron/sync/route.ts` 的 `syncFbForUser` — 三次教訓都固化在該函式的註解與 `maxMerge` 裡；確認你的改動沒繞過 read-then-max。
3. 手動觸發 daily-sync（見 cron-operations.md）→ 抽 2-3 篇貼文對照 FB 前台數字。
4. **Done**：新貼文與舊貼文都有非零互動、觸及欄有值或明確標示不可得、cron log 無吞掉的 #100。

## 相關陷阱
- **per-post insights 欄位展開會 #100 連坐**：手動同步曾因 insights 欄位展開讓**整支** route 500（memory `project_fb_sync_pagination_reach`）— reach 要走獨立的 per-post 端點，別合併進主查詢。
- **只抓第一頁漏歷史**：`/posts` 要翻頁；分塊處理避免 batch 500。
- ❌ 反例（觀察到的合理化）：「上次是 read-then-max 修好的，這次再加一層 max 就好」— 第 2 次復發證明 max 護不了無前值的新貼文，且第 3 次根因根本在 Meta 端；先分型再動手。

再驗證：`grep -n "post_media_view\|maxMerge\|read-then-max" apps/web/app/api/cron/sync/route.ts | head -5`
