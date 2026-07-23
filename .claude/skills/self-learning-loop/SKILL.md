---
name: self-learning-loop
description: 載入時機（觀察到的狀態）：要改 evaluator/few-shot/feedback 相關 code、qualityStats 或 evalScore 看起來不合理、要新增一種學習訊號、或要調 1.2/45天/14天/2000 這類門檻。
---

# 自我學習迴圈契約（驗證日 2026-07-13）

## 訊號優先序（架構的靈魂，不可倒置）
**人類行為 > 數據驗證 > LLM 評分。** 具體：`humanAction`（adopted > edited > rejected；`reverted`=後悔訊號）壓過 evalScore；7 天實際成效壓過生成時評分。任何把 LLM 評分放到人類訊號之上的提案都違反此契約。

## 三條支線（共用 `pages/{pid}/sidekickFeedback`）
| 支線 | source | 評審 | 7 天成效 |
|---|---|---|---|
| 診斷卡 | `diagnosis` | Gemini judge（haiku fallback），生成時＋每日行為感知重評 | 帳戶級 CTR/CPC/ROAS delta（有歸因護欄） |
| Sidekick 對話 | `sidekick` | **無自動評分**（serverless fire-and-forget 不可靠，§9.7 決策）— 靠 👍/👎 | 無 |
| 發文文案 | `draft` | **不經 LLM 評審、不進 qualityStats**（純人類＋數據） | 貼文互動＋觸及 vs 同粉專近 20 篇基準 |

## 每日批次（`app/api/cron/eval-rescore/route.ts`，13:30 台北）
- 成本護欄：每 doc 最多評兩次（humanAction 後一次、7 天窗口開啟後一次），flags `behaviorRescoredAt`/`effectScored`。
- **歸因護欄（2026-07-12 加）**：7 天回抓時窗口內 spend=0 → 標 `effectInconclusive: 'no_spend_in_window'`，不算負訊號。**為什麼**：戰役自然結束會讓帳戶指標歸零，沒有護欄時系統會把「戰役結束」誤學成「建議無效」。
- draft 支線：`postEffect = {engagementRatio, reachRatio}`，基準＝同平台近 20 篇平均（+1 平滑防除零），**任一 ratio ≥ 1.2** → `recommendToFewShot`。找不到貼文/Threads → inconclusive。加碼膨脹的觸及視為可接受（加碼本身也是採納訊號）。
- 執行偵測：`executed`（creativeFingerprint 變了才算真的去改）、`executedSpecific`（針對的那支素材真的變了）。

## Few-shot 回填
- 診斷卡：metadata 比對（alertType 固定列舉，夠用 — 決策 2026-06-02）。
- Sidekick：embedding 語意檢索（gemini-embedding-001，向量存 Firestore、記憶體 cosine — 資料量小不需向量 DB；>2000 筆時月度健檢會叫）。
- 文案（`lib/content/historyExamples.ts`）：**品質加權** — 驗證有效的 AI 文案（`source:'draft'` + `recommendToFewShot`）優先，觸及排序的歷史貼文補位（去重）。

## 健檢（月度 cron `self-learning-health`）
模型可用性、feedback 量（>2000 → 該換向量 DB）、**評審效度**：採納組 vs 拒絕組平均 evalScore，樣本足（採納≥10、拒絕≥5）且差距 <0.5 才告警。基線 2026-07-12 首測：8.26 vs 7.60（gap 0.66，**n=7/6**）。⚠️ **n 太小，此 baseline 本身還不穩定**——單一 outlier 就能讓 gap 波動超過 0.66。它的意義是**方向（採納組應 > 拒絕組）**，不是「未來要逼近 0.66 這個確切值」；別對讀數低於 0.66 就過度反應（那可能只是抽樣雜訊），累積更多樣本再重估基線。

## 可調門檻（都有出處，調前看理由）
| 值 | 位置 | 理由 |
|---|---|---|
| ratio ≥ 1.2 | eval-rescore | 保守起步；累積數據後看分佈再調 |
| 近 20 篇基準 | 同上 | 滾動、自比較（頁隔離友善） |
| 45 天 | cron/sync 殭屍偵測 | last_30d 窗口不可能產生 >45 天前的起始日 |
| 14 天 | mergePageAdInsights | snapshot 兩週沒刷新＝殭屍 |
| 2000 筆 | health cron | 記憶體 cosine 的 recall 底線 |

- ❌ 反例（觀察到的合理化）：「evaluator 分數低的建議直接不給使用者看，省得人工判斷」— 違反優先序：分數只餵學習與重試，**不做即時 gating**（互動路徑明文不阻塞，§9.3）。

再驗證：`grep -n "no_spend_in_window\|>= 1.2\|gap < 0.5" apps/web/app/api/cron/eval-rescore/route.ts apps/web/app/api/cron/self-learning-health/route.ts | head -5`
