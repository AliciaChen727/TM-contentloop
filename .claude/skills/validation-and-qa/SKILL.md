---
name: validation-and-qa
description: 載入時機（觀察到的狀態）：準備 commit/push、想寫測試、要驗證一個改動「真的有效」、或不確定什麼證據才算「做完了」。本 repo 沒有測試框架 — 證據標準跟一般專案不同。
---

# 驗證與 QA 標準（驗證日 2026-07-13）

## 事實：零測試框架
repo 內 0 個 `*.test.ts`、無 jest/vitest/playwright。這是刻意現狀（solo 產品、快速迭代），**不要**擅自引入測試框架 — 要引入是產品決策，先問 owner。品質靠下面的證據鏈。

## 證據鏈（每個改動的 Done 定義）
1. **三關**：`npx tsc --noEmit` + `npx eslint <改過的檔>` + `npm run build`，全綠。
2. **localhost 人工驗收**（鐵則，memory `feedback_deploy_flow`）：起 `npm run dev` → 告訴使用者測哪個路徑、預期看到什麼 → **停下來等使用者說 OK** → 才 commit+push。純文件改動可豁免。
3. **AI 修復 PR 同規則**：分支拉到本機 → localhost 驗收 → 使用者自己按 merge → Vercel。驗不過直接在分支上改再 push，不開新 PR。
4. **隔離驗收**（涉及粉專資料時必做）：雙粉專帳號交叉測試（見 page-isolation-contract.md）。

## E2E 驗證模式：throwaway 腳本打真資料
沒有 staging 環境 — 後端邏輯的驗證方式是寫臨時腳本直接對正式 Firestore 測，**測完清資料**。本 repo 實證有效的模式（Slice 18/20 都這樣驗的）：
```bash
cd apps/web
# 1. 寫 test-xxx-tmp.mts：從 .env.local 載環境變數（記得 tr -d '"'）→ 種一筆合成資料
#    （加 e2e/test 標記）→ 觸發目標邏輯（直接 import lib 函式，或打 localhost cron）
#    → assert 結果 → 刪除合成資料
npx tsx test-xxx-tmp.mts && rm test-xxx-tmp.mts
```
規範：(a) 合成資料必須帶可辨識標記（`source: 'e2e_test'` 之類）方便清理；(b) 產生的副作用（鈴鐺通知、GitHub Issue）也要清；(c) 負面案例優先 — Slice 20 的驗證就是靠「真實貼文 ratio 0.71 → 正確被擋」證明門檻邏輯對。

## 驗證要看「行為」不是只看 code
- 改 cron → 手動觸發一次（cron-operations.md），看 Firestore doc 實際變化。
- 改 Sidekick/診斷 → localhost 開新對話實測（**開新對話** — 舊對話 history 會延續舊行為，2026-07-11 誤判過一次）。
- 改發布 → 注意 FB dev-mode 可見性陷阱（config-and-flags.md）：驗可見性用非 App role 帳號。
- LLM 行為改動（prompt/工具語意）無法用三關驗 — 只能實測對話，且同一問題多測兩三次（有隨機性）。

## 已知的「驗不到」與對策
- 低分重試、fallback 路徑：localhost 難以自然觸發 → 依賴 code review＋fallback 保底設計（最壞情況＝原行為）。
- 7 天窗口類邏輯：用合成資料把 `adoptedAt` 倒填 8 天前（Slice 20 實例）。

- ✅ 正例：Slice 20 驗證 = 種合成 draft 記錄（adoptedAt 倒填）→ 打本機 eval-rescore → 確認 postEffect 數字與 recommendToFewShot 判定 → 刪資料。全鏈有真實證據。
- ❌ 反例（觀察到的合理化）：「三關都綠了，這改動是純後端，直接 commit 吧」— 本 repo 的鐵則是 localhost 使用者驗收後才 commit；三關只是下限。2026-07-12 有一次 build 綠但 Sidekick 行為錯（範圍鐵則缺失），是使用者在 localhost 抓到的。

再驗證：`find apps/web -name '*.test.ts' -not -path '*/node_modules/*' | wc -l`（應為 0；若不為 0 代表已引入測試框架，本檔需更新）
