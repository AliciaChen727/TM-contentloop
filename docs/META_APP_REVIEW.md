# Meta App Review 送審清單（contentloop）

> 目的：讓「非 Tester 的一般粉專管理者」也能授權連接。
> 在這些進階權限通過審核之前，只有 App 角色（admin/developer/tester）拿得到。

## 兩個 App 的分工

| App | 權限 | 是否需送審 |
|---|---|---|
| **contentloop auth**（Firebase 身份登入） | `email`、`public_profile` | ❌ 預設權限，免審。App 上線後任何人可登入 |
| **contentloop**（粉專/廣告 OAuth） | 下方清單 | ✅ 全部需要 Advanced Access |

---

## 需送審的權限清單（contentloop）

每個權限送審時，Meta 會要求：**(1) 用途說明 (2) 讓審核員可重現的操作步驟 (3) 螢幕錄影 (screencast)**。下面提供可直接改寫的說明文字。

### 1. `pages_show_list`
- **用途**：列出使用者管理的 FB 粉絲專頁，讓他選擇要連接哪一個。
- **送審說明**：
  > After the user logs in, ContentLoop calls `/me/accounts` to display the list of Facebook Pages the user manages, so the user can select which Page's performance data to connect and view in their dashboard.
- **Screencast 要拍**：登入 → 連接 → 出現粉專選擇清單 → 選擇粉專。

### 2. `pages_read_engagement`
- **用途**：讀取粉專貼文內容與互動數據（讚、留言、分享）。
- **送審說明**：
  > ContentLoop reads the user's own Page posts and their engagement metrics (reactions, comments, shares) via `/{page-id}/posts` to display a content performance table in the dashboard, helping the Page owner understand which posts perform best.
- **Screencast 要拍**：dashboard「內容表現」表格顯示貼文 + 讚/留言/分享數字。

### 3. `read_insights`
- **用途**：讀取粉專/貼文/IG 的成效洞察（觸及、曝光等）。
- **送審說明**：
  > ContentLoop reads Page and post Insights (reach, impressions) via the Insights API to show reach and engagement-rate charts in the dashboard, so the Page owner can track growth over time.
- **Screencast 要拍**：dashboard 顯示觸及/互動率圖表。

### 4. `instagram_basic`
- **用途**：讀取連動的 IG 商業帳號基本資料與貼文。
- **送審說明**：
  > ContentLoop reads the IG Business account linked to the user's Page (basic profile and media list) to display the user's Instagram posts alongside their Facebook content in one dashboard.
- **Screencast 要拍**：dashboard 顯示 IG 貼文（平台標示 IG）。

### 5. `instagram_manage_insights`
- **用途**：讀取 IG 貼文/帳號成效數據（觸及、儲存、瀏覽等）。
- **送審說明**：
  > ContentLoop reads Instagram media and account Insights (reach, saves, plays) to show Instagram performance metrics in the dashboard, giving the user a unified view of FB + IG results.
- **Screencast 要拍**：dashboard IG 貼文那列顯示觸及/儲存/播放數字。

### 6. `ads_read`
- **用途**：讀取廣告成效（花費、觸及、ROAS、CTR）。
- **送審說明**：
  > ContentLoop reads the user's ad insights via `/{ad-account}/insights` to display ad spend, reach, ROAS and CTR in the ads dashboard, helping the user evaluate which boosted posts and campaigns are effective. ContentLoop is read-only and never creates or edits ads.
- **Screencast 要拍**：廣告儀表板顯示花費/ROAS/觸及；「內容表現」貼文標示「有投廣告」+ 廣告指標。

### 7. `business_management`
- **用途**：讀取掛在 Business Manager（商家管理平台）底下的粉專與廣告帳戶。
- **送審說明**：
  > Many users manage their Page and ad account through Meta Business Manager rather than as a classic Page admin. ContentLoop calls `/me/businesses` to discover Pages and ad accounts owned via Business Manager, so these users can connect their assets. Read-only; ContentLoop does not modify any business settings.
- **Screencast 要拍**：用一個「粉專掛在 Business Manager 底下」的帳號連接 → 成功抓到粉專。

### 8. `pages_manage_metadata` —— ❌ 建議移除，不要送審
- **用途**：訂閱粉專 webhook、管理粉專設定。
- **已查證（2026-05-22）**：整個 codebase **完全沒用到**這個權限——沒有 `subscribed_apps`、沒有任何 Meta webhook 訂閱（`/api/lemonsqueezy/webhook` 是付款 webhook，與 Meta 無關）。
- **動作**：從 `connect/page.tsx` 的 SCOPES **移除** `pages_manage_metadata`。少送一個進階權限 = 少一項審核負擔與被拒風險。

---

## 送審前檢查

1. **App 要先填好基本資料**：隱私政策 URL、資料刪除說明 URL（你已經做了 privacy policy 和 data deletion 頁）、App 圖示、類別。
2. **準備一個測試帳號給審核員**：Meta 審核員會用你提供的帳號實際操作，要能登入並看到完整功能。
3. **每個權限一段 screencast**：清楚拍出「使用者操作 → 該權限對應的功能畫面」。
4. **Business Verification**：`business_management` 等權限通常要求完成商家驗證（Business Verification）。
5. **送審文案統一強調「唯讀」**：ContentLoop 只讀取資料做儀表板，不發文、不改設定、不動廣告——這點能大幅提高過審率。

---

## 通過之後

- 把這些權限設為 **Advanced Access** 並讓 App 上線（Live）。
- 之後一般使用者（非 Tester）授權時 Meta 就會直接給權限。
- **不再需要一個個加 Tester。**
