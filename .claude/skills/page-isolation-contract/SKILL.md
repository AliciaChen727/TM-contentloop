---
name: page-isolation-contract
description: 載入時機（觀察到的狀態）：要寫任何「讀貼文/廣告/洞察/對話」的 code、要新增粉專相關功能、儀表板出現不屬於當前粉專的數據、或兩個粉專的金額/貼文疑似互相污染。這是本 repo 最高階不變量，違反紀錄至少三次。
---

# 跨粉專隔離契約（驗證日 2026-07-13）

## 不變量（load-bearing）
只要請求帶了 `pageId`，回傳資料**只能屬於這一個粉專** — 對 viewer/admin/owner/super-admin 一律適用，「同一個 admin 管多個粉專」也適用（最容易漏的情境）。CLAUDE.md 有完整條文；本檔記「為什麼」與「在哪裡強制」。

## 為什麼是鐵則：三次真實事故
1. **2026-05-22**：`/api/insights/fb` legacy fallback 沒加 `${pageId}_` 前綴 → 兩粉專貼文混合顯示。
2. **2026-05-22**：OAuth 流程寫死 D67-centric → 其他粉專 admin 連接必失敗（#100 錯誤）。
3. **2026-07-12（最嚴重）**：cron 廣告 snapshot 存 `level=account` 未過濾 rollup → 共用廣告帳號（act_1802688673184780 同時跑 D67+Legacy 戰役）把 D67 的 $6,389 記到 Legacy 頭上、Legacy 的 $82 記到 D67 頭上；殭屍 snapshot 每晚被 merge 復活，污染持續數週才被使用者發現。修復＝commits d911e55/1d7d15c/2eb643a。

## 隔離在哪裡強制（code 層，不是 prompt 層）
| 層 | 檔案 | 機制 |
|---|---|---|
| Firestore 讀取 | 全部 API route | 只走 `users/{uid}/pages/{pageId}/...` 或 `pages/{pageId}/...`；FB legacy fallback 必加 `doc.id.startsWith(\`${pageId}_\`)`；IG 有 pageId 時完全不讀 legacy |
| 廣告歸屬 | `app/api/ads/sync/route.ts`、`app/api/cron/sync/route.ts` | ad-level insights + `effective_object_story_id` 頁前綴過濾（`matchesPage`/`pageAdsList`）；**絕不**用 account-level rollup 當頁數據 |
| AI 工具層 | `lib/ai/tools/pageDataTools.ts` | `ToolContext.allowedPageIds` 白名單，server 端解析（`resolveAllowedPages`），模型參數塞什麼都擋；診斷批次白名單鎖單頁 |
| Admin-only 面 | `app/api/pages/compare/route.ts` | 再過濾 `access === 'admin'`（受邀 viewer 看不到別頁） |

## 觸發 → 步驟
**觸發**：任何新讀取路徑、或懷疑數據污染。
1. 讀取一律以 pageId 為主鍵；問自己「這個 query 有沒有可能回傳別頁的 doc？」
2. API route 收 `pageId` 先驗權（admin 查 `metaTokens/{pageId}`、viewer 查 `viewerAccess`、成員查 `pages/{pageId}/admins|members`）。
3. debug/匯出/診斷等「非主流程」端點**同樣適用** — `/api/debug` 曾因此漏過。
4. **驗收（Done 定義）**：用同時管理 Legacy(235543696463178)＋D67(874392279086513) 的帳號登入，切 A 看不到 B 的任何貼文/廣告/數據，反之亦然。這是 release 前必要關卡。

- ✅ 正例：Slice 17 的 `compare_pages` 跨頁比較 — 合法，因為是「同一 admin 對自己名下粉專的**明示**比較」，且輸出絕不寫回任一單頁快照。
- ❌ 反例（實際觀察到的合理化）：「帳戶層 summary 是同一個廣告帳號的數據，帳號是這個 admin 自己的，直接存進頁快照應該沒關係」— 這正是 2026-07 污染的成因：**帳號 ≠ 粉專**，共用帳號跑多頁戰役時 account rollup 天生不可分頁。

## 污染自癒與偵測（修復後加上的防線）
- cron 每晚：帳號無本頁廣告 → 刪它的 `adAccountSnapshots` doc；merge 忽略 syncedAt >14 天的 snapshot；snapshot 集合全空 → shared doc 歸零重寫。
- 偵測器：merge 後 shared doc 的 `dateRange.from` 早於 45 天前 → 自動開 critical bug report（見 bug-pipeline-and-fix-agent.md）。

再驗證：`grep -n "matchesPage\|allowedPageIds\|startsWith(\`\${pageId}_\`)" apps/web/app/api/ads/sync/route.ts apps/web/lib/ai/tools/pageDataTools.ts | head`
