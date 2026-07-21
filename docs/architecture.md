# ContentLoop — 系統架構 (architecture.md)

> **⚠️ 2026-07-21 修正**：本檔第一版只描述 Phase 1（兩支 Firebase sync function、
> `users/{uid}/fbPosts` 舊路徑），已嚴重過時且與現況牴觸。本次重寫對齊實況。
> **架構的單一事實來源是根目錄 `CLAUDE.md`**；各子系統的「為什麼 / 在哪強制」看
> `docs/phase-*.md` 與 `.claude/skills/`（page-isolation-contract、cron-operations、
> agents-tooling-contract、publish-pipeline 等）。本檔只做「層級鳥瞰」，不重複細節。

## 系統概覽（2026-07）

```
[使用者瀏覽器]
      │  HTTPS
      ▼
[Vercel — Next.js 14 (App Router)]
  ├── /app/(auth)/          # Meta OAuth 連接（user-centric，抓連接者自己的粉專）
  ├── /app/dashboard/       # 廣告 / 內容 / 私訊儀表板
  ├── /app/api/             # Route Handlers（BFF：全走 Admin SDK + verifyIdToken）
  │     ├── insights/*      #   讀貼文/廣告/洞察（依 pageId 隔離、依日期區間查詢）
  │     ├── ads|insights/*/sync  # 手動同步（翻頁 + read-then-max）
  │     ├── ai/*, insights/report, ads 診斷  # Anthropic / Gemini 呼叫
  │     └── cron/*          #   排程任務入口（每日同步、通知、限動、發布、評審重跑…）
  │            │  CRON_SECRET 驗證；實際排程由 Vercel Cron / GitHub Actions 觸發
  ▼
[Firebase]
  ├── Firestore             # 貼文/廣告/診斷/通知/對話/發布草稿（page-scoped 為主）
  ├── Auth                  # Firebase Auth（Google 登入 or Email）
  └── Cloud Functions
        └── publishScheduled # 每 5 分鐘打 /api/cron/publish-scheduled（排程發布）
              │
              ▼
      [外部服務]
        ├── Meta Graph API   # FB Page / IG Business Insights + 發布寫入
        ├── Anthropic API    # Sidekick 對話、洞察報告、診斷卡片 agent（tool loop）
        ├── Google Vertex AI # 圖片/影片生成（owner service account）
        └── Gemini API       # 品質評審 judge + 檢索 embedding
```

> **AI Agent 層**：診斷卡片走 Anthropic tool loop（`runDiagnosisAgentWithTools`，
> `claude-sonnet-4-6`，失敗 fallback haiku 單次）；bug-fix agent 走 GitHub Actions
> workflow（`.github/workflows/bug-fix-agent.yml`，雙重 HITL）。詳見
> `docs/phase-3b-agent-tooling.md`、`docs/phase-3c-chatops-agents.md` 與
> `.claude/skills/agents-tooling-contract`、`bug-pipeline-and-fix-agent`。

## 元件職責說明

### 前端（Next.js / Vercel）

| 路徑 | 職責 |
|---|---|
| `app/(auth)/connect/page.tsx` | Meta OAuth 入口，抓「連接者自己管理的粉專」（見 CLAUDE.md OAuth User-Centric） |
| `app/api/auth/meta/route.ts` | 交換 token、每個 page token 各存一份、註冊 admin |
| `app/dashboard/ads/page.tsx` | 廣告儀表板（含手動 Sync latest data、診斷、素材排名） |
| `app/dashboard/page.tsx` | 內容表現（FB/IG/Threads，依日期區間查詢 + 表格分頁） |
| `app/dashboard/messages/page.tsx` | 私訊分析（Phase 5-1，唯讀） |
| `app/api/insights/fb\|ig/route.ts` | BFF 讀取：**依 pageId 隔離**、依 since/until 查詢、上限 1000 |
| `lib/ads/diagnosis.ts` | 診斷引擎（純函式，server/client 共用，單一事實來源） |
| `lib/publish/` | 草稿驗證（`validateDraft.ts`）、發布 runner |
| `lib/firebase/`、`lib/meta/` | Admin SDK 初始化、Meta Graph API 客戶端 |

### 後端排程（Vercel Cron / GitHub Actions + Firebase Function）

| 任務 | 觸發 | 職責 |
|---|---|---|
| 每日同步 | cron → `/api/cron/sync` | 抓 FB/IG 貼文 + 廣告，重算診斷（read-then-max 保護真值） |
| 通知/告警 | cron | 用 canonical 快照算診斷，發站內紅點 + 告警 email |
| 限動同步 | cron（每 ~4h）| IG/FB 限動 24h 過期，獨立抓 |
| 排程發布 | `publishScheduled`（每 5 分）→ `/api/cron/publish-scheduled` | 到點把已核准草稿發到 FB/IG/Threads |
| 評審重跑 | cron（每日）| 品質 evaluator 批次重評 + few-shot 反哺 |

> 完整、經驗證的排程清單與各自 schedule 見 `.claude/skills/cron-operations`。

### Firestore 資料結構（page-scoped 為主）

```
users/{uid}/
  metaTokens/{pageId}          # 每個粉專一份 page token（加密）+ igUserId + 狀態旗標
  pages/{pageId}/
    fbPosts/{postId}           # ✅ page-scoped，安全
    igPosts/{mediaId}          # ✅ page-scoped，安全
    pageStats/{date}           # 粉絲/追蹤數每日快照
  # ⚠️ users/{uid}/fbPosts、igPosts = legacy multi-page（多粉專混在一起）
  #    有 pageId 時：FB 讀 legacy 必加 `${pageId}_` 前綴；IG 完全不讀 legacy。
  #    見 CLAUDE.md「Legacy Collection 隔離規則」與 .claude/skills/page-isolation-contract。

pages/{pageId}/
  admins/{uid}                 # 第一個連接者為 owner
  adInsights/latest            # 廣告快照 + diagnosis / diagnosisCounts
  sidekickConversations/{sid}  # AI 對話存檔（需傳 pageId 才會寫）
  publishDrafts / scheduled    # 發布草稿與排程

fbPost.insights: { reactions, comments, shares, reach }
  # reach 來自 post_media_view（Meta 2026-06-15 移除 impressions 家族改用 views）
igPost.insights: { likes, comments, reach, saved, shares, views }
```

## Token 安全策略

1. Short-lived token → 後端交換 Long-lived token（~60 天）。
2. Long-lived token 加密後存 Firestore（`ENCRYPTION_SECRET`，正式站勿變）。
3. 前端**永遠不持有** Page Access Token；client 不直接讀 Firestore（一律走 BFF）。
4. Cloud Function / API route 讀 token 用 Firebase Admin SDK（server-side only）。
5. Token 失效時標記 `metaTokens/{pageId}` 狀態 → 儀表板顯示重新授權 banner。

## Meta Graph API 限制注意

- Development mode：目前透過 API 發到 FB 的內容僅 App role 帳號可見（Business Suite 手動
  發正常、IG/Threads 不受影響）→ go live 前 FB 發布＝預覽模式，統一旗標
  `NEXT_PUBLIC_META_APP_LIVE`。見 `.claude/skills/config-and-flags`。
- 送審中權限（12 個，含私訊×2 + business_management）狀態見 `docs/meta-app-review.md`。
- Rate limit：per-token 每小時額度有限，Insights/發布另有限制；同步走翻頁 + 分塊。

## 部署流程

```
程式改完 → tsc + eslint + next build 三關全綠
        → 本機 localhost 給使用者測 → OK → commit + push
        → GitHub / Vercel
             ├── Vercel Preview (PR)       # build 實際在這裡把關（CI 只跑 tsc+eslint）
             ├── Vercel Production (main)
             └── Firebase Deploy (functions/ 變更時)
```

> 純文件 / README / memory 改動可豁免 localhost 步驟。詳見 CLAUDE.md 協作規則第 6 條
> 與 memory `feedback_deploy_flow`。

## Roadmap

單一事實來源在 `CLAUDE.md` 的 Roadmap 表與 `docs/`：Phase 1 已上線；Phase 2 站內通知
中心（已上線）；Phase 3 AI Sidekick 優化 loop + 自我學習（3B agent 工具化已交付，3C
ChatOps + bug-fix agent 已交付）；Phase 4 半自動廣告更新（Meta 寫入，`ads_management`
+ App Review）；Phase 5 私訊分析 + FAQ chatbot。
