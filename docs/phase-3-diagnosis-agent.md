# Phase 3 — 批次成效診斷優化建議 Agent

> 規格文件（單一事實來源）。實作前請使用者確認，不自作主張。
> 關聯：`docs/phase-3-sidekick-self-learning.md`、`docs/goal-metrics.md`、CLAUDE.md「診斷引擎」「站內通知中心」段落。

## 1. 目標（一句話）

把現在「規則拼接、乾巴巴」的診斷建議，升級成 **Madgicx 風格的成效優化卡片**：有故事、有數字、有同業 benchmark 對比、有明確下一步 CTA。範圍**不只廣告，也含貼文（內容）**。由 Agent 批次生成，出現在 ① 廣告儀表板「診斷建議」② 小鈴鐺通知 ③ Email（主旨改為「成效診斷優化建議」）。

## 2. 已確認的決策（2026-06-01）

| 決策 | 結論 |
|------|------|
| Agent 與規則引擎關係 | **規則偵測 + Agent 改寫**。`lib/ads/diagnosis.ts` 仍是唯一「判斷有沒有問題」的來源（門檻、嚴重度、紅點觸發）；Agent 只負責把建議改寫成有故事/數字/CTA 的卡片，並補同業 benchmark 對比。 |
| 模型 | **Haiku 4.5**（`claude-haiku-4-5`）。批次、每頁每日跑、輸入結構化、輸出 JSON 卡片。若文案不夠打動人，升級路徑 = 改用 Sonnet。 |
| Benchmark 來源 | **先查產業數據寫成常數** `lib/ads/benchmarks.ts`（見 §6）。零額外 API、可審查。 |
| 內容診斷範圍 | 自然貼文互動率 + 最佳貼文建議加碼推廣 + 發文頻率/時段；外加既有的廣告警示提醒 + 廣告預算成本建議。 |

## 3. 核心架構原則（不可違反）

```
                 ┌─────────────────────────────────────────────┐
                 │  Layer 1 — 規則偵測（既有，唯一事實來源）       │
                 │  lib/ads/diagnosis.ts (+ 新增 content 規則)    │
                 │  → 決定「哪些是問題 / 嚴重度 / 紅點觸發」        │
                 │  → 純函式、無 model、deterministic            │
                 └───────────────────┬─────────────────────────┘
                                     │ DiagItem[] (+ 原始指標 + benchmark)
                 ┌───────────────────▼─────────────────────────┐
                 │  Layer 2 — Agent 改寫（新增，Haiku 4.5）       │
                 │  lib/ads/diagnosisAgent.ts                    │
                 │  → 把每個 DiagItem 改寫成 Madgicx 風格卡片      │
                 │  → 補 benchmark 對比句、可量化影響、明確 CTA    │
                 │  → 不新增/不刪除問題、不改嚴重度（只改文案）     │
                 └───────────────────┬─────────────────────────┘
                                     │ AiDiagCard[]（存 Firestore，帶 fingerprint）
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
  診斷建議頁                      小鈴鐺通知                     Email
  DiagnosisSection            NotificationBell           emailSender
  (紫框 + 卡片改用 Agent 文案)  (advice 改用 Agent 文案)    (主旨改「成效診斷優化建議」)
```

**鐵則**：
1. 嚴重度 / 紅點觸發 / 警示計數 **永遠來自 Layer 1**。Agent **不得**新增或抹除問題、不得改 severity。Agent 失敗 → fallback 用既有規則模板文案（系統不能因 LLM 掛掉而失靈）。
2. 門檻只改 `diagnosis.ts`（沿用 CLAUDE.md 既有鐵則）。benchmark 常數另存 `benchmarks.ts`，是「對比參考值」非「觸發門檻」。
3. **跨頁隔離**：新增的貼文診斷一律 page-scoped 讀 `users/{uid}/pages/{pageId}/fbPosts|igPosts`，遵守 CLAUDE.md 隔離清單。

## 4. Madgicx 風格 — 卡片要素（從截圖萃取）

每張卡片要素（對照 Madgicx「Stop-loss」「Retarget」「Fix tracking」三張）：

| 要素 | Madgicx 範例 | 我們的對應 |
|------|-------------|-----------|
| 圖示 emoji | 🛑 / ♻️ / 🍪 | 沿用 severity emoji 🚨⚠️✅ + 類型 emoji |
| 標題（結果導向，非指標名） | "Stop-loss for acquisition ads with no clicks" | 「這支素材每天燒錢卻沒人點」而非「CTR 偏低素材」 |
| 左欄敘事（為什麼重要，3 句） | "The last thing you want is to waste your budget…" | Agent 生成 3 句 `why`：問題→影響→我們怎麼幫 |
| 量化影響 | "You could have saved NT$X in 30 days" / "$0 spend" / "146 potential reach" | Agent 算出可量化句：如「過去 28 天這支多花了 NT$320 卻 0 點擊」 |
| Benchmark 對比 | （Madgicx 無，是我們的加值） | 「你的 CTR 0.20%，同業（非營利/教育）平均 1.4–2.2%」 |
| 明確 CTA 按鈕 | "Create Automation" / "Launch" / "Fix Tracking" | 「更換文案」「加碼推廣這篇」「問 AI 投手」 |

→ 新增 `AiDiagCard` 型別承載這些欄位（見 §5）。

## 5. 資料結構

### 5.1 既有 `DiagItem`（不動，Layer 1 產物）
`severity / type / title / desc / adset / metric / threshold / action / thumbnailUrl / storyId`

### 5.2 新增 `AiDiagCard`（Layer 2 產物，Agent 輸出）
```ts
interface AiDiagCard {
  refId: string          // 對應 DiagItem.id（或 content 規則 id），維持 Layer 1 ↔ 卡片連動
  severity: 'critical' | 'warning' | 'good'   // 直接抄 Layer 1，Agent 不可改
  domain: 'ad' | 'content'                     // 廣告 or 貼文
  emoji: string
  title: string          // 結果導向標題
  why: string[]          // 左欄 3 句敘事
  impact: string         // 量化影響句（可空）
  benchmark: string      // 同業對比句（可空）
  cta: { label: string; askAi: string }        // 按鈕文字 + 帶入 AiSidekick 的問句
}
```

### 5.3 儲存位置（沿用 insights report 快取模式）
- 存於 `pages/{pageId}/adInsights/latest` 新欄位：
  - `aiDiagnosis: AiDiagCard[]`
  - `aiDiagnosisFingerprint: string`（指標 hash，數據沒變就不重跑 Haiku → 省錢、文字穩定）
  - `aiDiagnosisUpdatedAt: Timestamp`
- 失效規則：`computeFingerprint(summary + creatives + posts)` 不同才呼叫 Haiku；同則直接讀快取（呼應 `project_insights_report_cache`）。

## 6. 同業 Benchmark 常數（`lib/ads/benchmarks.ts`）

依本次查到的 2025/2026 公開產業數據（來源見文末）。分會屬 **非營利／教育／活動報名** 性質，取保守區間：

```ts
export const META_AD_BENCHMARKS = {
  ctr:      { low: 1.4, mid: 1.9, high: 2.2, unit: '%' },   // 全產業健康 CTR ~1.4–2.2%
  cpcTraffic:{ good: 0.70, unit: 'USD' },                    // 流量型 CPC ~$0.70
  cpcLead:  { good: 1.92, unit: 'USD' },                     // 名單型 CPC ~$1.92
  nonprofitCpc: { avg: 0.39, low: 0.28, high: 0.54, unit: 'USD' }, // 非營利 CPC 年均 $0.39
  cpmLow:   { under: 8, unit: 'USD' },                       // 教育/在地服務 CPM 常 <$8
}
export const ORGANIC_ENGAGEMENT_BENCHMARKS = {
  facebook:  { low: 0.06, high: 0.2, unit: '%' },            // FB 自然互動率 0.06–0.2%
  instagram: { low: 0.45, high: 0.6, unit: '%' },            // IG 自然互動率 0.45–0.6%
  igCarousel: 0.52, igReels: 0.50, igSingleImage: 0.35,      // 依格式（%）
}
```
> 註：FB/IG 自然觸及與互動 2025 同比明顯下滑（FB 互動 −36%、IG −24%），benchmark 偏低屬正常，文案中要安撫使用者「低不代表你做錯」。

## 7. 內容（貼文）診斷規則 — 新增於 Layer 1

新增 `lib/ads/contentDiagnosis.ts`（與 ads `diagnosis.ts` 平行，同樣純函式、page-scoped 輸入）：

| 規則 | 觸發條件 | severity | 卡片方向 |
|------|---------|----------|---------|
| 自然貼文互動率偏低 | 貼文 engagement rate < FB 0.06% / IG 0.45% | warning | 對比 benchmark + 安撫 + 內容建議 |
| 最佳貼文值得加碼 | 某貼文自然互動率 ≥ 同帳戶 P75 **且** 未投廣告（無對應 ad storyId） | good | 「這篇自然成效最好卻沒推廣，建議 boost」（呼應 Madgicx retarget 卡） |
| 發文頻率/時段 | 結合既有「最佳時段」資料：近 N 天發文數過低 or 都發在低互動時段 | good/warning | 建議節奏與時間 |

> 「未投廣告」判定：用 CLAUDE.md 第 4 條 `effective_object_story_id` 前綴 `${pageId}_` 比對，確認該貼文沒有對應廣告。

合併：新增 `buildContentDiagnosis(posts, benchmarks)` 回傳 `DiagItem[]`（domain 標 `content`），與 `buildDiagnosis`（ad）的結果一起送進 Agent 與三個消費端。

## 8. Agent 實作（`lib/ads/diagnosisAgent.ts`）

- 輸入：`DiagItem[]`（ad + content）+ `summary` 指標 + 命中的 benchmark 常數。
- Prompt：系統提示設定「你是 Toastmasters 分會的 AI 廣告投手，語氣鼓勵、務實、講人話、給可執行步驟」。**Few-shot 用 Madgicx 截圖風格**（結果導向標題 + 3 句敘事 + 量化 + CTA）。要求嚴格回 JSON `AiDiagCard[]`（沿用 `api/ai/creative` 的 `parseBrief` 防護：抓第一個 `{...}`／容錯）。
- **Prompt caching**：系統提示 + benchmark 常數 + few-shot 設為 cache breakpoint（呼應 claude-api skill）。
- 約束注入：每個 card 的 `severity` 必須等於對應 `DiagItem.severity`（後處理覆寫，不信任 LLM）。
- 失敗 fallback：回傳 null → 消費端改用既有規則模板（DiagnosisSection 現有 `aiSummary` / `action`）。
- 觸發時機（三條路徑，與既有診斷更新對齊）：
  1. **每日 cron**（`api/cron/sync`）— 主要批次來源，算完診斷後接著跑 Agent。
  2. **手動同步**（`api/ads/sync`）— fingerprint 變了才重跑。
  3. **通知 cron fallback**（`processAlerts`）— 存的比 syncedAt 舊才重算。

## 9. 三個消費端的改動

### 9.1 診斷建議頁 `DiagnosisSection.tsx`
- 紫框「AI 投手建議」：有 `aiDiagnosis` 就用 Agent 的整體摘要；沒有就用現有 `aiSummary` 模板（fallback）。
- 每張診斷卡：標題/敘事/CTA 改用 `AiDiagCard`，保留既有 thumbnail + 查看貼文連結 + 「問 AI」按鈕（`cta.askAi` 帶入 AiSidekick）。
- 嚴重/警告計數仍來自 Layer 1 的 severity。

### 9.2 小鈴鐺 `lib/notifications/store.ts`
- `buildAdAnomalyNotification`：`advice` 與 `body` 改用 Agent 卡片文案（已預留 `actionPrompt` 欄位，Phase 3 填它）。
- `deepLink` 維持 `/dashboard/ads?pageId=...&section=diagnosis`（已可深連到診斷段，沿用近期 commit）。
- 標題語氣：從「N 項廣告需要注意」→「N 項成效診斷優化建議」。

### 9.3 Email `emailSender.ts`
- **主旨改寫**（使用者明確要求，去掉「廣告警示」）：
  - 多項：`[ContentLoop] {pageName} 成效診斷優化建議（N 項）`
  - 單項：`[ContentLoop] {pageName} 成效診斷優化建議：{標題}`
- 標頭 `📊 廣告成效警示` → `📊 成效診斷優化建議`。
- 內文用 Agent 卡片（標題 + why + benchmark + impact + 建議），CTA 按鈕維持「查看 AI 診斷 →」深連診斷段。
- 範圍含貼文：信中可同時列廣告與內容卡片。
- 設定頁文案（Image #7「廣告警示通知」）連帶更名為「成效診斷優化建議通知」，描述補一句「含貼文內容建議」。

## 10. 實作順序（vertical slice，一次一片）

1. **Slice 1 — benchmark 常數**：`lib/ads/benchmarks.ts`（純常數，零風險）。
2. **Slice 2 — 內容診斷規則**：`lib/ads/contentDiagnosis.ts` + 接入 page-scoped 貼文讀取（先讓診斷頁顯示，不接 Agent）。跨頁隔離雙粉專交叉測試。
3. **Slice 3 — Agent 改寫層**：`lib/ads/diagnosisAgent.ts` + Firestore 快取 + fingerprint。先只接診斷頁紫框與卡片。
4. **Slice 4 — 通知/Email 接 Agent 文案 + 改主旨**。
5. （Phase 3 後續）Quality evaluator / feedback memory（見 `docs/phase-3-sidekick-self-learning.md`）。

每片做完：`tsc --noEmit` + `eslint` + `next build` 三關全綠才 commit。

> ⚠️ **單位陷阱（Slice 2 已處理）**：儀表板的貼文互動率是 **reach-based**（(讚+留言+分享)/觸及），而 §6 的同業自然互動 benchmark 是 **follower-based**（不同分母）。直接對比會給出誤導性的「你贏同業」假象，因此 **content 規則一律自我相對**（median / P75 / 趨勢），不引用 §6 的自然互動數字。CTR 等廣告指標分母一致，才放心用 benchmark 對比。

## 11. 待使用者拍板的細項
- [x] 「最佳貼文加碼」門檻 → **混合**：ER ≥ P75 且 ≥ 1.5× 中位數 且未投廣告（已實作於 `contentDiagnosis.ts` C1）。
- [x] Agent 觸發 → **只在 fingerprint 變動時跑**（`diagnosisAgent.computeDiagFingerprint`，快取存 `pages/{pageId}/adInsights/latest.aiDiagnosis`）。
- [x] 卡片上限 → **critical/warning 全列 + good 取 top 2**（`selectItemsForAgent`）。

## 12. 實作進度
- [x] Slice 1 — `lib/ads/benchmarks.ts`
- [x] Slice 2 — `lib/ads/contentDiagnosis.ts` + 診斷頁顯示
- [x] Slice 3 — `lib/ads/diagnosisAgent.ts`（Haiku 改寫 + fingerprint 快取）+ `app/api/ai/diagnosis/route.ts` + 診斷頁紫框/卡片接 Agent 文案（fallback 回規則模板）。`AiDiagCard` 型別加在 `components/ads/types.ts`。
- [ ] Slice 4 — 鈴鐺 + Email 接 Agent 文案 + Email 主旨改「成效診斷優化建議」+ 設定頁更名。
- [ ] Phase 3 後續 — Quality evaluator / feedback memory。

---
### Benchmark 數據來源
- [WordStream — Facebook Ads Benchmarks 2025](https://www.wordstream.com/blog/facebook-ads-benchmarks-2025)
- [SuperAds — Facebook Ads CPC for Nonprofit (2025)](https://www.superads.ai/facebook-ads-costs/cpc-cost-per-click/nonprofit)
- [WebFX — Meta Marketing Benchmarks 2026](https://www.webfx.com/blog/social-media/meta-benchmarks/)
- [Socialinsider — Instagram Organic Engagement Benchmarks](https://www.socialinsider.io/social-media-benchmarks/instagram)
- [Hootsuite — Average engagement rates by industry](https://blog.hootsuite.com/average-engagement-rate/)
