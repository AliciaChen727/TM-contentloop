---
name: debugging-ads-data
description: 載入時機（觀察到的狀態）：廣告儀表板/Sidekick/比較頁顯示 $0 或明顯錯誤的花費、CTR、日期區間；使用者說「我明明有投廣告」；或兩粉專數字疑似互換。先讀本檔再動 code — 一半的案例根本不是 bug。
---

# 廣告數據排錯 Playbook（驗證日 2026-07-13）

## 第 0 步：$0 可能是正確答案
`adInsights/latest` 的 `summary`/`daily` 是**近 30 天滾動窗口**（cron 每晚重建）。戰役已結束的粉專顯示 $0 是**正常狀態**，不是同步異常 — 2026-07-12 使用者與 Sidekick 都誤判過。歷史戰役看 `adPostMetrics`/`igPostMetrics`（90 天、貼文層、跨帳號、已頁過濾）。

## 三層快照對照法（本次污染案就是這樣抓到的）
數據有三份，**逐層對照找不一致**：
| 層 | 路徑 | 寫入者 |
|---|---|---|
| A. 個人 | `users/{uid}/pages/{pid}/adInsights/latest` | 手動同步（完整：trends/demographics）＋cron |
| B. 每帳號 | `pages/{pid}/adAccountSnapshots/{act_id}` | cron（頁過濾切片）；手動同步不寫這層 |
| C. 共享 | `pages/{pid}/adInsights/latest` | cron merge（B 層合併）＋手動同步的補充欄位 |
儀表板與 AI 工具讀 **C**。症狀模式：
- A 對、C 錯 → B 層有殭屍/污染 snapshot，或 merge 條件沒觸發。
- C 的 `dateRange` 起點在一個多月前 → 殭屍 snapshot 被 merge（應已被 45 天偵測器回報）。
- A 有 trends/demographics、C 沒有 → 手動同步的共享寫入 gate 沒過（見下）。

**步驟**：寫 throwaway 檢查腳本 dump 三層的 `syncedAt/dateRange/dailyCount/spend`（腳本模式見 diagnostics-tooling.md）→ 定位錯在哪層 → 才動 code。

## 已知成因清單（全部真實發生過）
1. **共用廣告帳號污染**：account-level rollup 不可分頁。已修（cron 改 ad-level+頁過濾），但任何人再寫 account-level 聚合就會復發。
2. **殭屍 snapshot**：帳號選擇改變後舊 doc 殘留、每晚被 merge。已修（無本頁廣告→刪 doc；merge 忽略 >14 天）。
3. **共享寫入 gate 太嚴**（2026-07-12）：手動同步只在「有 ACTIVE 素材」時寫共享層 → 已結束（ARCHIVED）戰役的 trends/demographics 永遠進不了 C 層。已放寬為「任何頁匹配素材即寫」。復發特徵：A 層有、C 層沒有、該頁戰役已結束。
4. **Firestore set+merge 深合併殘留**：歸零寫入漏了 map 內某 key（如 `summary.linkClicks`）→ 舊值永遠殘留。歸零 `summary` 時必須列出**全部** key。
5. **幣別除數**：Meta 預算欄位對 TWD/JPY 等（`NO_DIVIDE` 集合，`app/api/ads/sync/route.ts`）回主單位、其他幣 ÷100 — 金額差百倍先查這個。
6. **`effective_status` 過濾**：查 ads 時 status 清單加 `DELETED` 會讓 Meta 回**空清單**（revert e924b62）。合法值只用現行 code 裡那組。
7. **日期區間**：儀表板「依使用者選的區間即時算」vs 紅點「用 canonical 快照算」— 規則同源、區間不同，數字不同是**預期行為**。

## Done 定義
指出錯誤層與成因（對照上表），修復後：手動觸發 cron（見 cron-operations.md）→ 重跑三層 dump 確認一致 → 使用者在儀表板確認數字。

- ❌ 反例（觀察到的合理化）：「兩個帳戶同步時間都是今天、日期區間欄位為空，代表 Meta API 未回傳有效區間，可能帳戶被暫停」— 這是 Sidekick 的錯誤推論；空 dateRange＋今日 syncedAt 只代表「近 30 天沒投放」。

再驗證：`grep -n "last_30d\|NO_DIVIDE\|pageMatchedCreatives.length > 0" apps/web/app/api/cron/sync/route.ts apps/web/app/api/ads/sync/route.ts | head -6`
