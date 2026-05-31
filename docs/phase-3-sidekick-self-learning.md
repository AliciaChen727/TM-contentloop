# Phase 3 — AI Sidekick 優化 loop + 自我學習 (Self-Learning Sidekick)

> **階段定位**（roadmap：Phase 2 / 3 / 4）：
> - **Phase 2**：站內通知中心（`phase-2-notification-center.md`）。
> - **Phase 3（本文件）**：通知帶優化建議 + 可複製 prompt 送進 Sidekick；並加上**批次審查 agent + Quality evaluator + feedback memory**，讓 Sidekick 越用越準。
> - **Phase 4**：半自動廣告更新（`phase-4-ad-automation.md`）。
>
> Phase 3 的核心：把 Sidekick 從「一次性問答」升級成「**有評估、有記憶、會自我修正的 loop**」。

```
批次審查 agent → 診斷 + 優化建議 → Sidekick 產出 → Quality evaluator 評分 → feedback memory
   (每日掃所有廣告)        ↑ 寫進 Phase 2 通知        ↑ 人類用             ↑ LLM-as-judge      ↑ 存好/壞範例
                                                                                              └──── 下次檢索回填 prompt ────┘
```

---

## 1. 目標與範圍 (Scope)

### In scope
1. **批次審查 agent**：每日（接在既有 sync 之後）掃過所有廣告，做診斷 + 產生優化建議，餵進 Phase 2 通知的 `advice` / `actionPrompt`。
2. **Sidekick 優化 loop**：通知 deep link → Sidekick 預填 `actionPrompt` → 產出新文案/素材方向。
3. **Quality evaluator**：LLM-as-judge，用固定 rubric 對 Sidekick 產出評分（0–5），低分自動重試或標記待人工。
4. **Feedback memory**：把（廣告 context + 產出 + 評分 + 人類採用與否）存 Firestore；下次同類情境檢索高分範例當 few-shot 回填 prompt → 自我學習。

### Out of scope
- ❌ 線上即時微調模型 / fine-tune（用 few-shot 檢索取代，不訓練權重）。
- ❌ 複雜多 agent 協作 graph（單一 reviewer + 單一 evaluator，不做 agent 群）。
- ❌ 寫入 Meta（那是 Phase 4）。

---

## 2. 批次審查 Agent

**觸發**：接在既有每日 sync 之後（GitHub Actions cron），或獨立 `/api/cron/batch-review`。
**職責（每個 pageId）**：
1. 讀最新 `adInsights/latest` 快照 + `detectAdAlerts` 的規則結果。
2. 對「有異常」或「成效偏離目標」的廣告，逐則（或分批）呼叫 Claude 產生：
   - 診斷（為什麼差）
   - 具體優化建議（`advice`，比 Phase 2 規則版更貼該素材）
   - `actionPrompt`（帶廣告名/目標/現況數據，可直接送 Sidekick）
3. 結果寫進 Phase 2 通知（升級 `advice` / 填 `actionPrompt`）。

**為何是「批次」**：一次處理整個粉專的廣告，比使用者逐則點開即時呼叫更省成本、可快取、可在離峰跑。

---

## 3. Quality Evaluator（LLM-as-judge）

**輸入**：廣告 context + Sidekick 產出（新文案/方向）。
**Rubric（範例，0–5 各維度）**：

| 維度 | 看什麼 |
|------|--------|
| 相關性 | 是否真的對應該廣告的問題（CTR 掉就改 hook，不是亂改） |
| 目標一致 | 是否貼合該粉專 `optimizationGoal`（clicks / conversion / reach / event） |
| 具體可執行 | 是不是給得出可直接用的文案，而非空泛口號 |
| 品牌語氣 | 是否符合 Toastmasters 調性（沿用 brandName/語氣設定） |
| 無捏造 | 沒有杜撰活動、數字、不實承諾 |

**流程**：產出 → evaluator 評分 → 
- 分數 ≥ 門檻：直接呈現給使用者。
- 分數 < 門檻：自動重試一次（把 evaluator 的扣分理由回灌 prompt）；再不過就標「需人工確認」。

> evaluator 與被評估者用同一個 Claude 模型即可（不同 prompt 角色），不需要額外服務。

---

## 4. Feedback Memory（自我學習迴路）

**資料模型**：
```
pages/{pageId}/sidekickFeedback/{id}
  adRef:        { adId, storyId }
  goal:         string            // optimizationGoal
  alertType:    string            // ctr_drop / frequency_high / cpc_spike
  context:      string            // 當時的廣告數據摘要
  output:       string            // Sidekick 產出
  evalScore:    number            // Quality evaluator 評分 0–5
  evalReasons:  string            // 扣分/加分理由
  humanAction:  'adopted' | 'edited' | 'rejected' | null   // 人類最終怎麼處理
  adoptedText:  string | null     // 若人類採用/改寫，存最終版本（最高品質訊號）
  createdAt
```

**學習迴路**：
1. **訊號收集**：evaluator 評分 + 人類最終動作（採用 > 改寫 > 拒絕）= 品質標籤。
2. **檢索回填**：下次同 `goal` + `alertType` 情境時，撈「高分 + 被採用」的前 N 筆當 **few-shot 範例**塞進 Sidekick / 批次審查的 prompt。
3. **效果**：Sidekick 自然偏向「過去被驗證有效」的風格與方向 —— 不需 fine-tune，就有自我學習效果（retrieval-augmented few-shot）。

**關鍵訊號優先序**：`humanAction === 'adopted'` 的 `adoptedText` 是最高品質的學習素材（人類真的用了）。

---

## 5. 架構決策（ADR）：Anthropic 原生 vs LangChain

**決策：Agent 邏輯用 Anthropic 原生；觀測/評估若需要再單獨接 LangSmith 免費層。不採用 LangGraph 編排框架。**

### 釐清
「LangChain 收費」實為 **LangSmith**（觀測/評估 SaaS）收費；OSS 框架（`langchain`/`langgraph`）免費可自架。兩個問題要分開看：(1) 要不要 LangGraph 編排？(2) 要不要 LangSmith 觀測？

### 選項比較
| 面向 | Anthropic 原生（Agent SDK / API + tool use） | LangGraph + LangSmith |
|------|-----------------------------------------------|------------------------|
| 既有契合 | ✅ 已用 Anthropic SDK（洞察報告）、已有 Vercel/Firebase runtime | 需引入框架 + 可能的託管部署 |
| 本案複雜度 | ✅ 批次審查/evaluator/memory 都是「結構化呼叫 + Firestore」，用不到狀態機 | LangGraph 的價值（複雜分支、durable、checkpoint HITL）目前用不到 |
| 成本 | 只付模型 token | OSS 免費，但 LangSmith Plus $39/seat/月；LangGraph 託管部署另計 uptime |
| 鎖定 | 無新依賴 | 多一層抽象 + vendor 依賴 |
| 觀測/評估 | 自建 Firestore logging + 本案的 evaluator | LangSmith 現成 trace/eval dashboard（免費層 5k traces/月） |

### 結論
- **批次審查 agent / Quality evaluator / feedback memory → Anthropic 原生**：結構化 Claude 呼叫 + Firestore，零新框架、零新基礎設施、無 per-seat。
- **「Anthropic 原生 sub-agent」在 server 端**＝ Claude Agent SDK (TypeScript) 的 subagents 或 API + tool use（**不是** Claude Code 的 Task/Agent，那是 CLI/開發環境用）。
- **LangSmith 免費 Developer 層可單獨評估**（只接觀測/eval，不用 LangGraph）—— 若想要現成 trace 視覺化與 prompt 版本管理。
- **LangGraph 留待**真有多 agent 協作、長流程、checkpoint 式人工中斷續跑時再導入。
- **原則**：先自己做、留好 logging，真的痛了再升級平台。

---

## 6. 工作拆解 (Tasks)
1. `/api/cron/batch-review`（或掛在 sync 後）— 批次審查 agent，升級通知的 `advice` / `actionPrompt`。
2. `lib/sidekick/evaluator.ts` — Quality evaluator（rubric prompt + 重試邏輯）。
3. `pages/{pageId}/sidekickFeedback` 資料模型 + 寫入（評分 + 人類動作）。
4. 檢索回填：Sidekick / 批次審查 prompt 組裝時，撈高分範例當 few-shot。
5. Sidekick UI：支援外部預填 `actionPrompt`（query param / deep link state），並記錄 `humanAction`。
6. （選配）評估接 LangSmith 免費層做 trace/eval 觀測。

---

## 7. 驗收標準 (Definition of Done)
- [ ] 批次審查每日跑完，異常廣告的通知帶有貼合該素材的 `advice` 與可用的 `actionPrompt`。
- [ ] 點通知 → Sidekick 已預填 prompt，產出可用建議。
- [ ] Quality evaluator 對產出評分；低分自動重試、過低標待人工。
- [ ] 使用者採用/改寫/拒絕的動作有寫進 feedback memory。
- [ ] 同類情境下，Sidekick 的 prompt 有撈到過去高分範例（可在 log 驗證 few-shot 確實注入）。

---

## 8. 開放問題
- evaluator 門檻分數設多少？重試幾次？（先 ≥3.5 / 重試 1 次）
- few-shot 撈幾筆、用什麼排序？（先「採用 > 高分」取前 3）
- 是否需要冷啟動種子範例（還沒累積 feedback 時）？建議先放 3–5 筆人工示範。
