# 廣告目標 → 指標對照

設定頁「廣告目標設定」選定的目標（`optimizationGoal`）會驅動三個地方的指標顯示：
總覽 KPI 排序、洞察報告 benchmark 列、同業基準值。本表供測試對應用。

> 儲存位置：`pages/{pageId}.onboardingData.optimizationGoal`（page-scoped，每個粉專獨立）。

## 來源檔案

| 用途 | 檔案 | 常數 |
|------|------|------|
| 總覽 KPI 卡片排序 | `apps/web/components/ads/sections/OverviewSection.tsx` | `GOAL_PRIORITY` |
| 洞察報告 benchmark 列 | `apps/web/components/ads/sections/InsightsSection.tsx` | `GOAL_AD_METRICS` |
| 中文標籤 | `apps/web/components/ads/sections/InsightsSection.tsx` | `GOAL_LABELS` |
| 同業基準值 | `apps/web/lib/benchmarks.ts` | `GOAL_BENCHMARKS` |

## 對照表

### 1️⃣ 提升點擊率 `clicks`
| 區塊 | 顯示指標（依序） |
|------|----------------|
| 設定頁卡片副標 | CTR / CPC / 連結點擊 |
| 總覽 KPI 排序（前三張） | CTR → CPC → 連結點擊數 |
| 洞察報告 benchmark | 廣告 CTR、廣告 CPA |
| 同業基準 | CTR 1.8% / CPC 280 / CPM 150 |

### 2️⃣ 提升轉換與 ROI `conversion`
| 區塊 | 顯示指標（依序） |
|------|----------------|
| 設定頁卡片副標 | ROAS / CPA / 轉換數 |
| 總覽 KPI 排序（前三張） | 點擊效益(roas) → CPA → 轉換數 |
| 洞察報告 benchmark | 廣告 ROAS（無購買追蹤時 N/A）、廣告 CTR、廣告 CPA |
| 同業基準 | CTR 1.5% / CPC 300 / CPM 120 |

### 3️⃣ 擴大品牌觸及 `reach`
| 區塊 | 顯示指標（依序） |
|------|----------------|
| 設定頁卡片副標 | CPM / 觸及 / 曝光 |
| 總覽 KPI 排序（前三張） | 觸及人數 → CPM → 曝光次數 |
| 洞察報告 benchmark | 廣告 CPM |
| 同業基準 | CTR 0.9% / CPC 500 / CPM 80 |

### 4️⃣ 活動報名推廣 `event`
| 區塊 | 顯示指標（依序） |
|------|----------------|
| 設定頁卡片副標 | CTR / CPL / 頁面瀏覽 |
| 總覽 KPI 排序（前三張） | CTR → CPL → 連結頁面瀏覽 |
| 洞察報告 benchmark | 廣告 CTR、廣告 CPA、廣告 CPM |
| 同業基準 | CTR 1.8% / CPC 280 / CPM 130 |

## 測試注意事項

1. **總覽 KPI 排序**：切換目標後，前 3 張卡片應換成上表那組，後面接預設順序
   （`roas / spend / cpa / ctr / cpm / reach / conversions / frequency`）。

2. **ROAS vs 點擊效益**：當活動 `conversionType` 非 `purchase`（例如 `link_click` /
   `video_view`），沒有真實營收 → 無法計算 ROAS：
   - 總覽第一張卡顯示「點擊效益（次/百元）」而非 ROAS（hover ⓘ 有說明）。
   - 洞察報告 benchmark 的「廣告 ROAS」顯示 `N/A · 需設定購買轉換追蹤`。
   - A/B 結果、實驗變體表、成效趨勢圖表/每週表的點擊效率一律標「點擊效益」；
     每週表另有一條獨立「ROAS」列顯示 `—（需購買追蹤）`。
   - 只有 `conversionType === 'purchase'`（有購買轉換追蹤）才顯示真實 ROAS（= 營收 ÷ 花費，單位 x）。

3. **洞察報告 benchmark 列**：固定顯示「平均互動率」「追蹤者成長率」兩列，
   再加上上表「洞察報告 benchmark」那幾列。

4. **同業基準值**：切換目標後 benchmark 的「同業 X」對照數字會跟著換（上表「同業基準」）。
