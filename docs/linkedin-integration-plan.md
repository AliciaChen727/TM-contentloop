# LinkedIn 整合計畫（路 A：Community Management API 自動化）

> 狀態：📋 規劃中，**gating on LinkedIn Community Management API 審核核准**。核准前無法測試，不開工。
> 決策：2026-07-06 使用者選「先送 API 審核，過了走路 A」。架構複製 Threads 整合（見 memory `project_threads_integration`）。

## 目標
把 Legacy 的 LinkedIn 公司專頁（Organization Page）數據整合進 ContentLoop 內容儀表板，成為 FB / IG / Threads 之外的**第四個平台**：貼文成效（曝光/互動）+ 追蹤數（併入三平台追蹤卡與折線圖）。

## LinkedIn 能取得的數據
- **追蹤者統計** `organizationalEntityFollowerStatistics`：追蹤數、每日增減、粉絲輪廓。
- **貼文/分享統計** `organizationalEntityShareStatistics`：impressions（曝光，對應我們的「觸及」）、unique impressions、clicks、likes、comments、shares、engagement rate。
- **貼文** Posts API（`/rest/posts`，取代舊 `ugcPosts`/`shares`）：內容、連結、時間。
- **專頁統計** `organizationPageStatistics`：專頁瀏覽數。
- 廣告需另接 LinkedIn Ads API（暫不做）。
- ⚠️ LinkedIn 無「reach（不重複觸及）」，用 **impressions（曝光）**，語意近似我們 Threads 的 `views`。

## 外部前提（使用者要先完成，這是 gating step）
1. 到 **LinkedIn Developer Portal** 建立 App。
2. App 綁定 Legacy 的 LinkedIn Company Page（Verify 步驟需頁面管理員在頁面設定裡確認）。
3. **申請 Community Management API 存取權**（Products 分頁 request）→ 需審核，可能要組織驗證與用途說明，**小型組織有被拒風險**。
4. 授權者必須是該 LinkedIn 專頁的**管理員**。
5. 核准後把以下交給開發：**Client ID / Client Secret**（Secret 進 Vercel env，不 commit）、要授權的**組織 URN**（`urn:li:organization:xxxxxx`）、把 redirect URI 加進 App 白名單。

## OAuth / 授權
- 3-legged OAuth 2.0：`https://www.linkedin.com/oauth/v2/authorization` → `.../accessToken`。
- Scopes（需 Community Management 核准才可用）：`r_organization_social`（讀貼文/分享統計）、`r_organization_admin` 或 `rw_organization_admin`（讀追蹤者統計/專頁統計）。**不需要**寫入類 scope（我們唯讀）。
- Access token ~60 天；有 refresh token（Marketing 類）→ 要存 refresh 並自動續期。
- API 呼叫要帶 header：`LinkedIn-Version: YYYYMM`（月版本）、`X-Restli-Protocol-Version: 2.0.0`。

## ContentLoop 架構（直接複製 Threads 那套）
| 元件 | 檔案 | 對照 Threads |
|---|---|---|
| OAuth 起始/回呼 | `app/api/auth/linkedin/authorize` + `callback` | `auth/threads/*` |
| Token 存放 | `users/{uid}/linkedinTokens/{pageId}`（獨立 collection，含 accessToken/refreshToken/orgUrn/expiresAt） | `threadsTokens` |
| Client wrapper | `lib/linkedin/client.ts`（token 存取 + refresh + 版本 header） | `lib/threads/client.ts` |
| 同步 | `lib/linkedin/sync.ts` → `pages/{pageId}/linkedinInsights/latest`；追蹤數每日快照 `pages/{pageId}/linkedinStats/{date}` | `lib/threads/sync.ts` + `threadsStats` |
| 唯讀 API | `app/api/insights/linkedin/route.ts`（page-scoped、驗權後讀 latest，正規化貼文 + 回傳 followersCount/followerStats） | `app/api/insights/threads/route.ts` |
| 連接卡 | `components/analytics/LinkedInConnectCard.tsx`，掛 `dashboard/settings` | `ThreadsConnectCard` |
| 每日 cron | 併進 `app/api/cron/sync` | 同 Threads |
| 儀表板顯示 | `dashboard/page.tsx`：新增 **LinkedIn 分頁** + `LinkedInPostsTable`；統計卡/折線圖納入 LinkedIn（追蹤數變四平台 `followersLi`） | `ThreadsPostsTable` + 三平台追蹤 |

### 指標正規化（存 latest 時對齊現有欄位）
- impressions → 觸及/reach
- likes → 按讚、comments → 留言、shares → 分享
- clicks / engagement rate → LinkedIn 專屬欄位（表格可加「點擊」欄）

## 風險 / 注意
- **審核**：核准不保證；若被拒 → 退回路 B（CSV 匯入，複製 `FbCsvImport` 模式，免審核）。
- **API 技術債**：Restli 協定、URN、月版本 header、分頁 cursor 跟 Meta 差很多 → 比 Threads 稍費工。
- **多分會**：正式給其他分會用同樣要各自授權其 LinkedIn 專頁（per-page token，架構已支援）。
- **正式化**：對外給非本人用，LinkedIn App 要從 Development 轉正、且 Community Management API 已核准。

## 開工條件
LinkedIn Community Management API **核准** + 使用者提供 Client ID/Secret + org URN + redirect 白名單就緒 → 才開始建（一個 vertical slice，複製 Threads 流程）。
