# 報名連結追蹤 + Meta CAPI ROAS

> ContentLoop 自建的短網址 / 點擊 / 報名完成追蹤，並把報名（含金額）透過 Meta Conversions API 回報給 Meta 算 ROAS。
> 程式於 2026-06-10 上線（commit `4768462`）。本文件是這套功能的單一事實來源。

## 它解決什麼

廣告 →（中間第三方報名表）→ 完成報名。Meta 看不到「中間表單」與「完成」，所以 ROAS 欄常是「—」。
這套功能讓 ContentLoop 當中間層：流量先經過我們的短網址 → 記錄點擊與完成 → 再把帶金額的轉換回報給 Meta。

## 三個階段

| 階段 | 內容 | 需要 Meta 嗎 |
|------|------|------|
| A 點擊追蹤 | 短網址 `/r/{slug}` 記點擊（bot 過濾） | 否 |
| B 報名完成 | `/c/{slug}` 回報 + 表單 webhook，對回原點擊算轉換率 | 否 |
| ROAS① | 轉換時用 Meta Conversions API 回報金額 → Meta 算 ROAS | 是（Pixel ID + CAPI token） |

## 架構與檔案

| 端點 / 檔案 | 作用 |
|------|------|
| `app/r/[slug]/route.ts` | 公開轉址：查 `shortLinks/{slug}` → bot 過濾 → 記 click + 計數 → 擷取 `fbclid`→`fbc` → 302 轉址；啟用追蹤時種 cookie + 夾帶 `cl_id` |
| `app/c/[slug]/route.ts` | 完成回報：讀 cookie / `cl_id` 對回點擊 → `recordConversion` → 導感謝頁 |
| `app/api/links/webhook/[slug]/route.ts` | 表單 webhook（Tally/Typeform）：驗 `token` → 取隱藏欄位 `cl_id` → 記轉換 |
| `app/api/links/route.ts` | 管理 API（BFF）：建立 / 列表 / 停用，verifyIdToken + admin，page-scoped |
| `app/api/integrations/meta-capi/route.ts` | CAPI 設定：存 Pixel ID + 加密 token、發測試事件驗證 |
| `lib/links/util.ts` | slug 產生、bot UA 偵測、IP 雜湊 |
| `lib/links/server.ts` | `recordConversion()`：去重計數 + 觸發 CAPI |
| `lib/meta/capi.ts` | `sendCapiEvent()` / `buildFbc()` |
| `app/dashboard/links/page.tsx` | 管理頁 UI（中英雙語）+ CSV 匯出 + CAPI 設定卡 |

### Firestore 資料模型

```
shortLinks/{slug}                       # 公開查表（/r 無登入需快速查到目的地）
  pageId, destination, active, trackConversion, thankYouUrl
pages/{pageId}/links/{slug}             # page-scoped 管理 + 分析
  label, destination, source:{postId}, value, currency,
  clickCount, conversionCount, trackConversion, conversionToken
  /clicks/{clickId}        ts, uaCategory, referer, ipHash, isBot, capi:{fbc,rawIp,rawUa}
  /conversions/{clickId}   ts, clickId, via, capi:{ok,error,eventName,value}
pages/{pageId}/integrations/metaCapi    # pixelId, accessTokenEnc(加密), enabled
```

隔離（CLAUDE.md）：所有讀寫 page-scoped；`shortLinks` 只放 `/r` 需要的最小資料 + pageId；停用前驗證 slug 屬於該 page。

### 對回機制（哪次點擊→哪次完成）

- **Cookie 法**：`/r` 在本網域種 `cl_{slug}=clickId`，`/c` 讀回。同瀏覽器有效，跨裝置失效。
- **參數法**：`/r` 把目的地加 `?cl_id={clickId}`，表單透過 webhook / 隱藏欄位帶回。跨裝置也準。

## 使用者操作

### 建一條追蹤連結
`/dashboard/links` → 貼報名表連結 → （要 ROAS 就）勾「追蹤報名完成」+ 填金額（免費填 0）→ 產生短網址。

### 表單設定（讓「完成」回報）
- **Tally / Typeform**：送出後導向貼「完成回報網址」；或設 webhook + 隱藏欄位 `cl_id`
- **SurveyCake**：結束導向貼「完成回報網址」
- **Google 表單**：原生不支援，需加 Apps Script `onFormSubmit` 呼叫 webhook（或改用 Tally）

### ⚠️ 廣告目的地
廣告的目的地網址要設成**短網址 `/r/{slug}`**（不可直接指向報名表），否則 `fbclid` 會掉、ROAS 歸不到該廣告。

---

## Meta CAPI 設定（取得 Pixel ID + token）

> CAPI 用 Events Manager 的權杖，**不需要 App Review**（跟 Phase 4 寫廣告不同）。

### 前置：商家資產管理組合（Business Portfolio）
建立網站資料集需要先有 Business Portfolio。Events Manager → 連結資料 → 網站 → 若提示「需要商家資產管理組合」→ 點「建立商家資產管理組合」→ 填商家名稱 / 姓名 / Email。

### 拿 token（主流程）
1. 開 [business.facebook.com/events_manager](https://business.facebook.com/events_manager2)
2. 右上角 business 選對（例：Legacy Toastmasters Club）
3. 左側 **資料集** → 點**網站型**資料集（地球/螢幕圖示，**不是手機**＝那是 App 資料集，沒有網站 CAPI 權杖）
4. **設定** → **Conversions API** → **手動設定** → **產生存取權杖** → 複製
5. **Dataset ID** = 該資料集名稱旁的編號

### 備案（主流程 wizard 出錯時）
- **備案 A**：過幾小時或換瀏覽器重試「手動設定」（Meta wizard 常暫時性出錯）。
- **備案 B（繞過 wizard）**：商業管理平台設定 → 使用者 → **系統用戶** → 新增「ContentLoop」(admin) → **指派**剛建的網站資料集 → **產生新權杖**（勾 `ads_management`）。此 token 一樣能用。

### ✅ 實戰走過的完整路徑（2026-06-13 首次設定，最可靠）

主流程 wizard 常卡住（選「網站」按繼續沒反應），實際成功的路徑如下，照這個走最穩：

1. **確認手上的舊資料集都是 App 資料集、不能用**：事件管理工具看到的 `ContentLoop / ContentLoop Dev / Contentloop Auth` 等，**分頁有「Facebook SDK」、設定頁全是「應用程式編號 / iOS / SKAdNetwork」、沒有「Conversions API」** → 全是 App 資料集，CAPI 用不了（程式打 `{id}/events`，App 資料集收不到）。
2. **新建一個「網站」資料集**：事件管理工具左上角綠色「**＋ 連結資料**」→ 選「**網站**」→ 在「建立新的資料集」彈窗填名稱（例 `ContentLoop Web`）、類別留空 → **建立**。
   - 若「連結資料 → 網站 → 繼續」沒反應 → 開**無痕視窗**或關掉廣告攔截器再試；仍不行走下方備案 B。
3. **選整合方式**：建好後它會問「連結你的網站資料」→ 選「**設定轉換 API**」（**不是** Meta 像素，我們沒有要在網站貼 JS）。
4. **選事件**：勾「**完成註冊（CompleteRegistration）**」+「**購買（Purchase）**」即可，其他無害可不管（程式只送這兩個）。
5. **選事件詳情**：顧客資料參數加勾「**點擊編號（fbc）**」「**用戶端 IP 位址**」（程式實際會送的；其餘 email/電話/姓名**不要勾**，報名表在第三方拿不到）。
6. **查看指示 → 開啟實作指南**（不要按「傳送指示」email）→ 找「**產生存取權杖**」→（保持 Dataset Quality API Recommended）→ 按下去 → **立刻複製權杖**（`EAA` 開頭；Facebook 不幫你存，關掉要重產）。
7. **與廣告帳號共用**：把這個網站資料集分享給**實際跑廣告的帳號**（本案 `act_329347941177339`），ROAS 才歸得到。
8. **回 ContentLoop 正式站**貼 Dataset ID + 權杖 → 儲存並測試 → 綠勾「已連線並通過測試事件」。

### 🔑 Dataset ID 到底在哪（最常卡這裡）

設定卡的「Pixel / Dataset ID」要填**網站資料集自己的編號**，找法：
- **看網址列最準**：在資料集頁面時網址是 `…/events_manager2/implementation_instructions/【1491541229092942】?business_id=3617616568552330…` → `implementation_instructions/` 後面、`?` 前面那串（本案 `1491541229092942`）就是 Dataset ID。
- 或：左側「資料集」清單 → 新資料集**名稱下方那串數字**。

### 常見錯誤
- **找不到「Conversions API / 產生存取權杖」**：你點到的是 **App 資料集**（分頁有「Facebook SDK」、設定全是應用程式編號 / SKAdNetwork）。要另**建網站資料集**。
- **Dataset ID 貼錯**：以下三種都**不是** Dataset ID——
  - `business_id=3617616568552330`（網址裡的）= **商家** Legacy Toastmasters Club
  - `1288330390162210` = **App** ContentLoop 的應用程式編號
  - `擁有者` 下方的編號 = Business ID
  正解是 `implementation_instructions/` 後面那串、或資料集清單名稱下方的編號。
- **設定卡紅字「Invalid OAuth access token - Cannot parse access token」**：權杖欄是空的（或貼到非 `EAA` 開頭的東西）。貼上正確權杖即消失。
- **wizard「選網站按繼續沒反應」**：Meta 前端 bug，開無痕視窗 / 關廣告攔截器重試，或走備案 B（系統用戶）。

### 在 ContentLoop 設定
`/dashboard/links` → 📈 Meta 轉換回報卡 → 貼 **Dataset ID + token** → 儲存並測試連線 → 綠勾 = 成功（Events Manager「測試事件」會收到一筆 `CompleteRegistration`）。

> ⚠️ **一定要在正式站設定**：本機 `.env.local` 的 `ENCRYPTION_SECRET` 與正式站不同，本機存的 CAPI 設定正式站解不開。CAPI 設定是**每個粉專一份**。

### 指派廣告帳號（ROAS 才歸得到）
網站資料集 → 設定 → 分享 → **與廣告帳號共用** → 選實際跑廣告的帳號。

## 驗證流程（本機）

1. 開 `…/r/{slug}?fbclid=TEST123` → 跳到報名表
2. 同瀏覽器開 `…/c/{slug}` → ✅ 完成頁
3. 列表「完成 +1、轉換率出現」；重開 `/c` 不會重複計（clickId 去重）
4. （設好 CAPI）Events Manager 收到帶 `fbc` 的 `Purchase`/`CompleteRegistration`

## 短域名（之後）
`/r` `/c` 走 `NEXT_PUBLIC_APP_URL`，預設 `tm-contentloop.vercel.app`。要漂亮短域名（如 `tmcl.link`）：買域名 → DNS 指向 Vercel → 改這個 env，程式不動。

## 後續可做
- /c 也埋 Meta Pixel，與 CAPI 用 `event_id` 去重（提升匹配率）
- 把連結點擊/轉換併進「每篇貼文成效」（已預留 `source.postId`）
