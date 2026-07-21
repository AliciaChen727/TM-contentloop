---
name: diagnosis-engine-contract
description: 載入時機（觀察到的狀態）：要改診斷門檻/文案/規則、紅點數字跟診斷頁對不上、通知內容跟儀表板不一致、或想新增一個「發通知的異常偵測」。
---

# 診斷引擎契約（驗證日 2026-07-13）

## 單一事實來源
規則只有一份：`apps/web/lib/ads/diagnosis.ts`（純函式，server/client 共用）。改門檻/文案**只動這個檔**，三個消費端同步生效：
1. 診斷建議頁（`app/dashboard/ads/page.tsx` 的 `buildAdData`）— 依使用者選的日期區間 client 即時算。
2. 紅點通知＋告警 email（`lib/alerts/processAlerts.ts`）— 用 canonical 快照算；只有 critical/warning 發通知。
3. 「AI 投手建議」紫框（`DiagnosisSection.tsx` 的 aiSummary）— 模板字串，非 LLM。

**已知的「不是 bug」**：診斷頁與紅點數字不同 = 區間不同（即時區間 vs canonical 快照），規則同源，預期行為。

## 禁止事項
- `lib/alerts/detector.ts`（`detectAdAlerts`）**已棄用**，檔案保留未刪 — 別把任何新通知接回它。
- LLM 卡片層（下述）**不可**信任 LLM 的 severity/refId/數字 — `parseAndEnforceCards`（`lib/ads/diagnosisAgent.ts`）會以來源覆蓋 severity/domain、丟棄幻覺 refId、`projection` 數字必勝 LLM 輸出。改卡片邏輯不可繞過這層。

## LLM 卡片層（規則之上的改寫層）
`lib/ads/diagnosisAgentServer.ts`：
- 主路徑 `runDiagnosisAgentWithTools`：claude-sonnet-4-6 + Firestore 工具（白名單鎖單頁）、max 6 次工具呼叫、prompt 要求「引用數字必先用工具核對」。
- Fallback：`runDiagnosisAgent` 單發 claude-haiku-4-5-20251001。
- 評分不過門檻 → 重試一次（tool loop 版：4 輪＋25 秒 timeout，超時退 haiku 單發；理由回灌 prompt；分數更高才採用）。
- **Fingerprint 快取**：`computeDiagFingerprint`（選定 items 的內容 hash）存於 `pages/{pid}/adInsights/latest.aiDiagnosisFingerprint` — 同樣的診斷發現不重生成。**排錯要點**：卡片「不更新」通常是 fingerprint 沒變（資料沒變），不是 bug；要強制重生成＝手動同步改變資料、或清掉該欄位。
- 診斷結果存 `diagnosis`/`diagnosisCounts`/`diagnosisUpdatedAt`，三條更新路徑：每日 cron、手動同步、通知 cron fallback（存的比 syncedAt 舊就重算）。

## 觸發 → 步驟（改規則時）
1. 只改 `lib/ads/diagnosis.ts`。
2. 三關 + localhost：診斷頁、紅點、email 三個消費端都要人工看過一輪。
3. **Done**：三個消費端呈現一致的新規則；`good`-only 情境保持靜默（不發通知）。

再驗證：`grep -rn "detectAdAlerts(" apps/web/app apps/web/lib --include='*.ts' | grep -v detector.ts | wc -l`（應為 0 — 指實際「呼叫」；`lib/notifications/store.ts` 尚有一句提及 detectAdAlerts 的舊註解，非消費端）
