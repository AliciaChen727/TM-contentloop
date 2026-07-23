---
name: failure-archaeology
description: 載入時機（觀察到的狀態）：你正要提議的方案似曾相識（改 Meta 查詢參數、換 Gemini 模型、加背景任務、動 OAuth 流程、砍儀表板欄位）、或在 git log 看到 revert 想知道為什麼。這裡是已付過學費的死路清單 — 重走前必讀。
---

# 死路考古（驗證日 2026-07-13）

## Revert 紀錄（git 可查）
| Commit | 死路 | 為什麼死 |
|---|---|---|
| e924b62 | ads 查詢的 `effective_status` 加 `DELETED` | Meta API 直接回**空清單**（不是回含 DELETED 的清單）— 整頁廣告消失 |
| cd85b05 | 改 `mapFbPost` 的 reach 取值 | 廣告儀表板直接 crash — 該欄位有下游依賴，動它要全鏈檢查 |
| d943ba6 | 移除 ads 儀表板 PostsSection 的廣告欄位 | 使用者要求復原 — 「看起來多餘」的 UI 欄位可能是使用者依賴的；砍 UI 先問 |

## 不在 git 裡的死路（session/memory 記載）
1. **Gemini API key 生圖/生影片**：多次測試失敗 → 定案走 owner GCP Vertex AI service account（memory `feedback_vertex_ai`）。**文字** API 是另一條路、可用（gemini-2.5-flash 評審）。別再試用 API key 生圖。
2. **`gemini-2.0-flash` 無額度、`text-embedding-004` 不存在**（此 key 下）：評審固定 `gemini-2.5-flash`（thinkingBudget 0）、embedding 固定 `gemini-embedding-001`（3072 維）。月度 health cron 會盯模型可用性。
3. **Vercel serverless 的 fire-and-forget 背景工作**：response 結束後 function 可能凍結，背景 eval 不保證跑完 → Sidekick 自動評分因此**不做**（設計文件 §9.7）。要背景工作＝用 cron 或真 queue，別再提 fire-and-forget。
4. **FB dev-mode 可見性誤判**（2026-07-12 定案）：曾誤信「文字/圖片豁免」— 真相是 dev mode 下 API 發到 FB 的**所有內容**僅 App role 可見。先前的「暫時性降觸及」假設作廢。驗收鐵則：FB 可見性一律用**非 App role 帳號**驗證。
5. **OAuth 寫死單一粉專（D67-centric）**：非 D67 admin 連接必拿誤導的 #100。現行：先 `getAllManagedPages`，`META_PAGE_IDENTIFIER` 只當補充。
6. **`lib/alerts/detector.ts`（`detectAdAlerts`）已棄用**：通知來源已改診斷引擎，檔案保留未刪。別把新通知接回它（詳 diagnosis-engine-contract.md）。
7. **Canva 整合兩坑**（PR #22/#23）：素材上傳 Content-Type 必須 `application/octet-stream`（否則 415）；Create Design **不能指定 preset**（只帶 asset_id）。另外 Canva API 不能就地改既有設計 — AI 想「局部修改設計稿」是做不到的，UI 已有對應話術。
8. **Firestore `where`+`orderBy` 組合**：需要 composite index，本 repo 慣例是**避開**（fetch recent + 記憶體過濾）。**但這是「現規模」的取捨、不是永久鐵則**：composite index 是廉價的正常功能（`firestore.indexes.json` 一條），一旦某 collection 要掃 >數百筆、或「fetch recent + 記憶體過濾」會漏掉窗口外的符合 doc，就直接建 index，別無條件沿用（否則資料長大後會靜默退化：漏抓、egress 變大、變慢）。
9. **Timestamp 用 `>` 直接比較**：Firestore Timestamp 物件比較不可靠，一律 `toMillis()` 再比（2026-07-12 修過一處）。
10. **LLM 自我修正的邊界**：診斷 LLM 曾捏造數字 → 解法不是 prompt 拜託，是 code 層強制（`parseAndEnforceCards`：severity/refId 從來源覆蓋、projection 數字必勝 LLM 輸出）。任何「請 LLM 保證正確」的提案，優先改成 code 驗證。

- ❌ 反例（觀察到的合理化）：「查詢多帶 DELETED status 可以把歷史廣告一起抓回來，資料更完整」— e924b62 證明 Meta 直接回空，功能全滅。Meta API 的參數行為以實測為準，不以直覺為準。

再驗證：`git -C /Users/pei-wenchen/Files/TM-contentloop log --oneline e924b62 cd85b05 d943ba6 -3 2>/dev/null | head -3`
