# 裝置成效分析計畫（各裝置 廣告成效 + 報名轉換）

> 狀態：📋 規劃中。回答「Meta 能否抓使用者看廣告的裝置、並細分各裝置的成效/轉換率」。
> 決策：2026-07-07 使用者要完整 plan。

## 目標
知道使用者用什麼裝置看廣告，並比較**各裝置的曝光 / CTR / 花費 / CPA / 轉換率**，找出「哪種裝置最會看、最會轉換報名」。

## Meta 能力與限制（重要）
- Meta Ads Insights 有 **`impression_device`** breakdown：`iphone`、`ipad`、`android_smartphone`、`android_tablet`、`desktop`、`other`…（另有 `publisher_platform`、`platform_position`）。
- 依裝置可拿：**曝光(impressions)、點擊、花費、CTR、CPA、轉換(actions)**。
- ⚠️ **Meta 不提供「依裝置的 reach（觸及）」**：reach 是去重人數，同一人可能多裝置看過，無法乾淨拆分。→ 裝置維度**用「曝光」不是「觸及」**（跟現有 `publisher_platform` breakdown 同樣情況）。所以問題實作為「各裝置的曝光/CTR/轉換率」。

## 兩條 Track（可分開做）

### Track A — Meta 廣告端（各裝置廣告成效）
完全複製現有 `publisher_platform` breakdown 的模式（`app/api/ads/sync/route.ts` §Platform breakdown）。

1. **抓取**（`app/api/ads/sync/route.ts`，新增一個 breakdown 呼叫，與 platform/demographics 平行）：
   ```
   GET {adAccountId}/insights
     fields=ad_id,spend,clicks,impressions,actions,action_values
     breakdowns=impression_device
     level=ad, limit=500, {dateRange}, access_token=userAccessToken
   ```
   - **頁隔離**：跟現有一樣，`if (!filteredAdIds.has(r.ad_id)) continue`（只算屬於本 pageId 的 ad）。
   - Meta 禁止把 `impression_device` 跟 age/gender 或 publisher_platform 合併在同一次請求 → **獨立呼叫**（同 platform breakdown 的理由）。
2. **聚合**：`Map<device, {spend,clicks,impressions,conversions,revenue}>`。把原始值歸類成友善桶：`iPhone / iPad / Android 手機 / Android 平板 / 桌機 / 其他`（reconcile 到總花費）。
3. **儲存**：存進 `adInsights` 的新欄位 `deviceBreakdown`（跟 `platformBreakdown`/`demographics` 併存）。
4. **型別**（`components/ads/types.ts`）：新增
   ```ts
   export interface DeviceBreakdown { device: string; spend: number; clicks: number; impressions: number; conversions: number; revenue: number }
   // AdData 加 deviceBreakdown?: DeviceBreakdown[]
   ```
5. **顯示**（`components/ads/sections/AudienceSection.tsx` 加一區塊，或新 `DeviceSection`）：表格
   | 裝置 | 曝光 | 點擊 | CTR | 花費 | CPA | 轉換 | 轉換率 |
   - CTR = clicks / impressions；CPA = spend / conversions；轉換率(CVR) = conversions / clicks。
   - 標註「Meta 不提供依裝置的觸及，故用曝光」。
6. **mockData**（`components/ads/mockData.ts`）補 deviceBreakdown 假資料，讓沒接真資料時畫面完整（沿用專案 mock-first 慣例）。

### Track B — 自家報名端（各裝置的報名轉換，first-party）
不受 Meta reach 限制、且直接對到「報名」這個真轉換。你們的 `r/{slug}` 短連結已記 referer + `cl_id` tie-back 報名。

1. **點擊記錄加 user-agent**（`app/r/[slug]/route.ts`）：`clickRef.set({ ..., userAgent: req.headers.get('user-agent')?.slice(0,300) })`。
2. **解析裝置**：用輕量 UA 解析（規則式：判斷 iPhone/iPad/Android/Mac/Windows → mobile/tablet/desktop + OS），存 `device` 欄位。避免引入笨重套件。
3. **統計**：報名連結追蹤頁（`app/dashboard/links`）新增「各裝置」視圖 = 依 device 分組的**點擊數 / 報名數(cl_id 綁到的轉換) / 報名轉換率**。
4. 產出：知道「手機點最多但桌機轉換率較高」之類的洞察，且是真報名、非 Meta 估計。

## 指標定義
- CTR = 點擊 / 曝光
- CPA = 花費 / 轉換
- CVR（轉換率）= 轉換 / 點擊
- Track A 轉換來源 = Meta `actions`（需轉換有回傳 Meta，你們有 CAPI `meta-capi`）；Track B 轉換來源 = 自家報名（cl_id tie-back）

## 頁隔離（必守）
- Track A：ad-level breakdown 一律 `filteredAdIds.has(r.ad_id)` 過濾，只算本 pageId 的廣告（同現有 demographics/platform）。
- Track B：短連結本就 per-page（`r/{slug}` 綁定粉專），照現有隔離。

## 風險 / 注意
- **reach 不可依裝置** → 全程用曝光，UI 要講清楚避免誤解。
- **資料量少**：分會廣告花費不高，裝置細分後每桶樣本可能小，數字波動大 → UI 標註「樣本小僅供參考」。
- **Meta breakdown 組合限制**：impression_device 不能跟其他 breakdown 併請求 → 獨立呼叫（已知）。
- **UA 解析**：規則式即可，不追求 100% 精準；不引入大套件。

## 建議順序
1. **先做 Track A**（Meta 各裝置廣告成效）— 跟現有 breakdown 同模式，最快、可直接進洞察報告/廣告儀表板。
2. 再做 **Track B**（自家報名裝置轉換）— 需動短連結記錄 + links 頁顯示，價值高但獨立。

## 開工條件
使用者選 Track A / B / 兩者 → 各自是一個 vertical slice（跑三關 + localhost 測 → commit）。
