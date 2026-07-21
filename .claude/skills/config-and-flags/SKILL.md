---
name: config-and-flags
description: 載入時機（觀察到的狀態）：FB 發布行為怪異（別人看不到/變預覽模式）、要切 Meta App Live、找某個環境變數的作用、金額差百倍、或權限判斷（super-admin/owner）行為不明。
---

# 設定與旗標（驗證日 2026-07-13）

## Meta App 狀態旗標（`lib/content/fbStoryFlag.ts`）— 最重要的一組
- `NEXT_PUBLIC_META_APP_LIVE`：**主開關**。Meta App Review 通過後設 `'1'`，一次恢復 FB Story＋FB 影片發布，不需改 code。
- `FB_STORY_ENABLED = META_APP_LIVE || NEXT_PUBLIC_FB_STORY_ENABLED`（舊變數仍可單獨開 Story）。
- `FB_VIDEO_ENABLED = META_APP_LIVE`（只有主開關能開）。
- **背景事實（2026-07-12 定案，曾誤判）**：dev mode 下 API 發到 FB 的**所有內容**只有 App role 帳號看得到 → go live 前 ContentLoop 的 FB 發布視為預覽模式、正式 FB 貼文用 Business Suite 手動發、影片自動改發封面圖（`useFbCover` 邏輯）。**驗收 FB 可見性一律用非 App role 帳號。**
- Meta App 對照：**832**755139382467 = 實際串接/送審的 App；**858**… = 僅 FB 登入（Firebase Auth provider）。送審狀態看 `docs/meta-app-review.md` 第 7 節。

## 權限相關
- `SUPER_ADMIN_UIDS`（逗號分隔）：read-level god-mode，**刻意**跨越頁隔離（僅產品 owner）。每個 super-admin 路徑必須先 `verifyIdToken` 再 `isSuperAdmin(uid)`。bug 通知也發給這組人。
- `OWNER_UIDS`：另一組（用量計費相關）— 與 SUPER_ADMIN_UIDS 不同用途，別混用。
- 角色能力表在 `lib/auth/roles.ts`（viewer→editor→admin→owner 疊加）；「跨粉專總覽」的 gate 是 `members.manage`（admin+）。

## 金額陷阱
Meta 預算欄位的單位依幣別：`NO_DIVIDE` 集合（TWD/JPY/KRW…，在 `app/api/ads/sync/route.ts`）回主單位、其他 ÷100。TWD 是**實測**出來的（Meta 文件說法與實際不符）。金額差百倍先查這裡。

## AI 相關 key 解析順序
Anthropic key：呼叫者自己的（`getUserApiKey`）→ 頁 owner 的 → `ANTHROPIC_API_KEY` env。Gemini：`GEMINI_API_KEY` env → user key。生圖/影片走 owner GCP Vertex SA（**不是** Gemini API key — 死路見 failure-archaeology.md）。

## Bug pipeline 相關
`GITHUB_BUG_TOKEN`（fine-grained PAT，Issues R/W）、`GITHUB_BUG_REPO`（預設 `AliciaChen727/TM-contentloop`）、GitHub Actions secret `ANTHROPIC_API_KEY`（修復 agent 用）。

## 完整環境變數清單（44 個，名稱可 grep）
```
grep -rhoE 'process\.env\.[A-Z_]+' apps/web/lib apps/web/app --include='*.ts' --include='*.tsx' | sort -u
```
值全部在 `apps/web/.env.local`（不在 git）與 Vercel 環境變數 — `user-must-provide`。注意 `.env.local` 的值**多數帶引號**，shell 抽值要 `tr -d '"'`（cron-operations.md 有事故記錄）。

**Done 定義**（動旗標後）：localhost 驗行為 → 正式站 Vercel env 改完**要重新部署才生效**（環境變數不會熱更新）。

再驗證：`grep -n "META_APP_LIVE\|FB_VIDEO_ENABLED" apps/web/lib/content/fbStoryFlag.ts | head -4`
