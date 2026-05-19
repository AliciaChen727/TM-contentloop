# ContentLoop — 專案世界觀 (CLAUDE.md)

## 專案定位
個人品牌經營者用的 AI 內容操作工具。
**Phase 1 範圍**：從 Toastmasters 分會 FB 粉專 + 連動 IG 抓取貼文成效資料，儲存到 Firestore，用 Next.js 儀表板呈現。

## 技術棧
| 層 | 技術 |
|---|---|
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| 後端 | Firebase Cloud Functions (Node.js 20, TypeScript) |
| 資料庫 | Firestore |
| 身份驗證 | Firebase Auth + Meta OAuth 2.0 |
| 外部 API | Meta Graph API (FB Page Insights + IG Business Insights) |
| 部署 | Vercel (前端) + Firebase (後端) |

## 環境資訊
- Firebase 專案：`contentloop-dev`（Blaze plan）
- Meta App：Business 類型，Development mode
- FB Page：TM 分會粉專（使用者為 Admin）
- IG：Business 帳號，已連動上述 Page

## 協作規則（AI 行為準則）
1. **重大決策前先問**，不自作主張
2. **先規劃 → 使用者確認 → 再寫 code**
3. **一次完成一個 vertical slice**，不東改西改
4. **每個檔案職責單一**，component 不超過 200 行
5. 所有 secret / token 只存 `.env.local`（前端）或 Firebase Secret Manager（後端），絕不 commit

## Vertical Slices 規劃（Phase 1）
| # | Slice | 狀態 |
|---|---|---|
| 1 | Meta OAuth + 取得 Long-lived Page Token | 🔲 未開始 |
| 2 | Cloud Function 定時抓 FB Insights，寫入 Firestore | 🔲 未開始 |
| 3 | Cloud Function 定時抓 IG Insights，寫入 Firestore | 🔲 未開始 |
| 4 | Next.js 儀表板：FB 貼文成效表格 + 圖表 | 🔲 未開始 |
| 5 | Next.js 儀表板：IG 貼文成效表格 + 圖表 | 🔲 未開始 |

## Firestore 資料模型（草案）
```
users/{uid}
  metaTokens/page          # Page access token (encrypted)
  fbPosts/{postId}         # FB 貼文成效快照
  igPosts/{mediaId}        # IG 貼文成效快照
```

## 命名慣例
- 資料夾：kebab-case
- 元件：PascalCase
- 工具函式：camelCase
- Firestore collection：camelCase 複數（`fbPosts`, `igPosts`）

## AI Sidekick 整合規則（新增儀表板必讀）

每個儀表板頁面使用 `<AiSidekick>` 時，**必須傳入 `pageId` prop**，否則：
- 對話不會存進 `pages/{pageId}/sidekickConversations`
- 歷史面板顯示「尚無歷史紀錄」
- Owner 看不到「匯出」按鈕

### 正確寫法
```tsx
<AiSidekick
  open={skOpen}
  onClose={() => setSkOpen(false)}
  contextPage="posts"          // 或 "overview" / "creative" / "diagnosis" 等
  pageId={pageData?.pageId ?? undefined}   // ← 必須加
  metricsContext={...}
/>
```

### 已整合的儀表板
| 頁面 | 檔案 | contextPage |
|---|---|---|
| 廣告儀表板 | `apps/web/app/dashboard/ads/page.tsx` | overview / diagnosis / creative 等 |
| 內容表現 | `apps/web/app/dashboard/page.tsx` | posts |

### Firestore 路徑
- 有 `pageId`：`pages/{pageId}/sidekickConversations/{sessionId}`（對話存檔、歷史、CSV 匯出）
- 無 `pageId`：fallback 讀 `users/{uid}/aiInsights`（舊系統，不支援匯出）
