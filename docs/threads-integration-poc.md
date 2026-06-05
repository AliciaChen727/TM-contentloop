# Threads 串接 PoC 規劃（內容表現再加一個平台）

## 背景
ContentLoop 現在抓 FB 粉專 + IG 商業帳號的內容/廣告成效。Threads（Meta 的文字社群）
已開放官方 **Threads API**（端點 `graph.threads.net`），可抓自然內容成效。把 Threads
接進來＝「內容表現」從 FB / IG 擴成 **FB / IG / Threads** 三平台。

⚠️ **定位**：Threads **不能投廣告** → 沒有花費 / CTR / CPC / ROAS。所以它只進「**內容表現**」
（自然貼文那一側），**不進廣告儀表板**。

## 抓得到什麼（Threads API insights）
- **貼文層級**（`/{media-id}/insights`）：views、likes、replies、reposts、quotes、shares、連結點擊
- **帳號層級**（`/{threads-user-id}/threads_insights`）：views、likes、replies、reposts、quotes、
  **followers_count**、**follower_demographics**（國家/城市/年齡/性別）
- **貼文清單**（`/me/threads`）：id、media_type、text、permalink、timestamp
- 趨勢 7–90 天；可看內容被從哪發現（IG/FB 外溢）

## 認證（獨立 OAuth，不能沿用 FB/IG token）
- Threads 有**自己的 OAuth**：authorize 在 `threads.net/oauth/authorize`，
  scope = **`threads_basic` + `threads_manage_insights`**（要讀 insights）。
- 流程：code → 短期 token → 換 **長期 token（60 天、可刷新）** → 由 `/me` 取 `threads_user_id`。
- **App Review**：`threads_manage_insights` 給非 tester 的一般用戶需 Meta 審核
  （App 目前 Development mode → 先加 tester 可測）。
- Threads 帳號綁在 IG 帳號上；每個要看的粉專/帳號各連一次、各存一份 token。

## 技術設計（對齊現有 BFF 架構）
- **OAuth route**：`app/api/auth/threads/authorize` + `app/api/auth/threads/callback`
  （比照現有 Meta / Canva OAuth）。存 token + threadsUserId。
- **Token 儲存（per-page、遵守跨頁隔離 [[page-isolation]]）**：
  `users/{uid}/metaTokens/threads__{pageId}`（或 `pages/{pageId}.threadsUserId` + 加密 token），
  以 pageId 為界，A 粉專看不到 B 的 Threads。
- **Sync route**：`app/api/threads/sync`（POST {pageId}）— BFF（Bearer + 驗權），用該頁的
  Threads token 打 `graph.threads.net`：抓貼文 + 逐則 insights + 帳號 insights，存
  `users/{uid}/pages/{pageId}/threadsPosts/{id}` + `pages/{pageId}/threadsInsights/latest`。
- **同步排程**：併進現有 GitHub Actions / Firebase cron（跟 IG/FB 一起，每日）。
- **UI**：內容表現頁加「Threads」來源（跟 FB / IG 並列的 toggle / 分頁），
  顯示貼文成效 + 帳號追蹤者/受眾。互動率 benchmark 可沿用依產業那套（[[industry-benchmarks]]）。

## 資料模型（草案）
```
users/{uid}/pages/{pageId}/threadsPosts/{mediaId}   # 單篇成效快照
pages/{pageId}/threadsInsights/latest               # 帳號層級（追蹤者/受眾/趨勢）
pages/{pageId}.threadsUserId                         # 設定
```

## 分階段
- **Phase 1（PoC）**：OAuth 連接 → sync 貼文 + insights → 內容表現頁顯示 Threads。先用 tester 測。
- **Phase 2**：併進每日 cron、加進洞察報告的「內容」段、Threads 互動率納入同業比較。
- **Phase 3（選配）**：App Review 過 `threads_manage_insights` → 開放一般用戶自助連接
  （比照 GA4 的自助精靈 [[ga4-integration]]）。

## 風險 / 待確認
- **App Review**：`threads_manage_insights` 對一般用戶要審核（tester 先測）。
- **無廣告數據**：Threads 純自然內容，別把它接到廣告/ROAS 邏輯。
- **token 60 天要刷新**：需排程刷新長期 token（同 Meta 長期 token 處理）。
- **帳號綁定**：使用者要有啟用 Threads 的帳號（綁 IG）。

## 面試講法
「Threads 我評估過官方 API：它有完整的自然內容 insights（觀看/互動/追蹤者/受眾輪廓），
但**沒有廣告**，所以我會把它接到『內容表現』而不是廣告側，定位成『內容成效再加一個平台』。
它是獨立 OAuth + 需 App Review 的新 vertical，所以我會先用 tester 做 PoC、跑通再申請審核開放，
跟我做 GA4 串接是同一套漸進策略。」
