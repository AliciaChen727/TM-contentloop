# ContentLoop — 系統架構 (architecture.md)

## 系統概覽

```
[使用者瀏覽器]
      │  HTTPS
      ▼
[Vercel — Next.js 14]
  ├── /app/(auth)/        # Meta OAuth 流程
  ├── /app/dashboard/     # 儀表板頁面
  └── /app/api/           # Route Handlers (BFF)
      │  Firebase Admin SDK / Firestore REST
      ▼
[Firebase]
  ├── Firestore           # 貼文成效資料儲存
  ├── Auth                # 使用者身份（Google 登入 or Email）
  └── Cloud Functions
        ├── syncFbInsights   # 定時抓 FB Page Insights
        └── syncIgInsights   # 定時抓 IG Business Insights
              │  HTTPS
              ▼
        [Meta Graph API]
          ├── /me/accounts              # 取得 Page token
          ├── /{page-id}/posts          # 貼文列表
          ├── /{post-id}/insights       # 貼文成效
          ├── /{ig-user-id}/media       # IG 貼文列表
          └── /{media-id}/insights      # IG 貼文成效
```

## 元件職責說明

### 前端（Next.js / Vercel）

| 路徑 | 職責 |
|---|---|
| `app/(auth)/connect/page.tsx` | Meta OAuth 入口，引導使用者授權 |
| `app/(auth)/callback/page.tsx` | 接收 OAuth code，交換 token，寫入 Firestore |
| `app/dashboard/page.tsx` | 儀表板首頁，組合各 widget |
| `app/api/insights/fb/route.ts` | BFF：從 Firestore 讀 FB 資料回傳前端 |
| `app/api/insights/ig/route.ts` | BFF：從 Firestore 讀 IG 資料回傳前端 |
| `components/dashboard/` | 圖表、表格 UI 元件 |
| `lib/firebase/` | Firebase Admin SDK 初始化（伺服器端） |
| `lib/meta/` | Meta Graph API 客戶端（token 交換） |

### 後端（Firebase Cloud Functions）

| Function | 觸發方式 | 職責 |
|---|---|---|
| `syncFbInsights` | Cloud Scheduler（每日）| 抓 FB Page 貼文 + Insights，寫 Firestore |
| `syncIgInsights` | Cloud Scheduler（每日）| 抓 IG 媒體 + Insights，寫 Firestore |
| `refreshMetaToken` | Cloud Scheduler（每 50 天）| 刷新 Long-lived Token |

### Firestore 資料結構詳細版

```
users/
  {uid}/
    metaTokens/
      page:
        pageId: string
        pageName: string
        accessToken: string      # 加密儲存
        tokenExpiry: Timestamp
        igUserId: string
    
    fbPosts/
      {postId}:
        postId: string
        message: string
        createdTime: Timestamp
        permalink: string
        snapshotAt: Timestamp
        insights:
          impressions: number
          reach: number
          engagedUsers: number
          reactions: number
          comments: number
          shares: number
          clicks: number
    
    igPosts/
      {mediaId}:
        mediaId: string
        caption: string
        mediaType: string        # IMAGE | VIDEO | CAROUSEL_ALBUM
        permalink: string
        timestamp: Timestamp
        snapshotAt: Timestamp
        insights:
          impressions: number
          reach: number
          likes: number
          comments: number
          saved: number
          shares: number
          plays: number          # VIDEO only
```

## Token 安全策略

1. Short-lived token（1 小時）→ 後端交換 Long-lived token（60 天）
2. Long-lived token 加密後存 Firestore（使用 KMS 或 Cloud Secret Manager）
3. 前端**永遠不持有** Page Access Token
4. Cloud Function 讀取 token 使用 Firebase Admin SDK（Server-side only）

## Meta Graph API 限制注意

- Development mode：只有 App 管理員帳號可授權
- 需申請的 Permissions：
  - `pages_read_engagement`
  - `pages_show_list`
  - `read_insights`
  - `instagram_basic`
  - `instagram_manage_insights`
- Rate limit：每個 token 每小時 200 calls（Insights API 額外限制）

## 部署流程

```
git push → GitHub Actions
  ├── Vercel Preview (PR)
  ├── Vercel Production (main branch)
  └── Firebase Deploy (functions/ 變更時)
```

## Roadmap

廣告告警 → 通知 → 優化 → 自動更新的分階段規劃：**Phase 2** 站內通知中心（[`phase-2-notification-center.md`](./phase-2-notification-center.md)）→ **Phase 3** AI Sidekick 優化 loop + 自我學習（[`phase-3-sidekick-self-learning.md`](./phase-3-sidekick-self-learning.md)，含批次審查 agent / Quality evaluator / feedback memory，agent 採 Anthropic 原生）→ **Phase 4** 半自動廣告更新（[`phase-4-ad-automation.md`](./phase-4-ad-automation.md)，需 Meta `ads_management` 寫入權限 + App Review）。
