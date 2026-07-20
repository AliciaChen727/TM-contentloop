# Meta Ads MCP 下一階段優化參考

日期：2026-07-17

## 決策摘要

Meta Ads MCP / Ads AI Connectors 對 ContentLoop 有參考價值，但定位應是「內部 AI 操作、研究與 Phase 4 原型工具」，不應取代目前正式產品的資料同步與自動化後端。

建議維持：

- ContentLoop backend：正式資料收集、Firestore canonical snapshot、站內通知、診斷規則、自動化執行與審計紀錄。
- Meta Ads MCP：內部測試、AI Sidekick 研究、廣告診斷 prompt 驗證、Phase 4 廣告 spec 原型。

## 對 Roadmap 的影響

### 收集廣告數據

幫助程度：中

MCP 可讓 AI 即時查詢 ad account、campaign、ad set、ads 與 insights，適合內部分析與快速驗證問題。但排程 ETL、Firestore 快照、dashboard 穩定查詢仍應維持現有 Marketing API sync pipeline。

不建議把 MCP 當成正式資料來源，原因：

- 不適合承擔 cron / canonical snapshot。
- 多使用者、多粉專隔離仍需由 ContentLoop 自己控管。
- 產品查詢需要可重現、可快取、可審計的資料層。

### 自動發布 / 更新廣告

幫助程度：中高

MCP 可用來測試 AI 產生 campaign / ad set / ad creative spec，並驗證 Meta 官方工具層的 schema 與操作流程。

正式產品仍應走 ContentLoop 自己的 Phase 4 寫入流程：

- 使用 Meta Marketing API。
- 需要 `ads_management` 與 App Review。
- 建立前必須有人審核。
- 新建或修改廣告預設應保守處理，例如 paused / draft 狀態。
- Firestore 需保存 request spec、操作者、審核狀態、執行結果與錯誤。

### 廣告診斷分析

幫助程度：高

MCP 很適合作為 AI Sidekick / internal analyst 的資料工具，用來快速查：

- 最近 7 / 14 / 30 天 campaign 成效變化。
- 高花費低結果的 ad set。
- CTR / CPC / CPM / CPA 異常。
- creative 疲乏或表現落差。
- 診斷引擎規則未覆蓋的補充洞察。

但正式診斷規則仍應以 `lib/ads/diagnosis.ts` 為單一事實來源，避免核心產品邏輯黑箱化。

## 建議實驗清單

1. 用 MCP 對同一個 ad account 跑「最近 7 天廣告健康檢查」。
2. 將 MCP 產出的異常清單與 ContentLoop 診斷引擎結果比對。
3. 整理 MCP 能穩定回傳的欄位，映射到現有 `AdInsight` / diagnosis input。
4. 測試讓 AI 產生一份 campaign / ad set / ad creative spec，但不實際啟用。
5. 將 spec 轉成未來 Phase 4 Marketing API 寫入 payload 的草案。

## 採用原則

- 不為 MCP 改掉現有架構。
- 不讓 MCP 直接寫入 ContentLoop 正式資料庫。
- 不讓 MCP 繞過產品內的權限、審核、審計流程。
- 可用 MCP 加速研究與原型，但正式產品仍由 ContentLoop API route / Firebase / Marketing API 管線執行。
- 涉及多粉專資料時，仍遵守 page-scoped isolation；任何結果都必須綁定明確 `pageId` / ad account。

## 後續觸發條件

當 Phase 4 半自動廣告更新開始實作時，重新評估 MCP 是否可作為：

- 廣告 spec 產生器的參考工具。
- AI Sidekick 的內部診斷輔助工具。
- 測試 Marketing API payload 的對照工具。

不把它設為正式後端依賴，除非 Meta 官方提供適合 SaaS server-side、多租戶、可審計的正式產品整合模式。
