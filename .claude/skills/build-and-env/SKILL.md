---
name: build-and-env
description: 載入時機（觀察到的狀態）：要跑 build/tsc/eslint、build 突然報 ENOWORKSPACES 或 "Failed to patch lockfile"、要從零重建環境、要裝新依賴、Vercel build 過不了但本機過、或 ffmpeg 相關 route 在正式環境 ENOENT。
---

# Build 與環境（驗證日 2026-07-13）

## 佈局事實
- **Monorepo**：yarn 1.22.22 workspaces（`apps/*`, `functions`）。tracked lockfile 是根目錄 `yarn.lock`；`node_modules` hoist 在根目錄（檢查已裝 SDK 的型別要看 `<repo>/node_modules/...`，不是 `apps/web/node_modules`）。
- **程式都在 `apps/web`**（Next.js 14 App Router）。`functions/` 是舊 Firebase Cloud Functions（`publishScheduled`/`syncFbInsights`/`syncIgInsights`），改動它要 `firebase deploy --only functions`，跟 Vercel 無關。
- 根目錄有未追蹤的 `package-lock.json` — 歷史雜物，別 commit 它。

## 三關（每次改完程式，commit 前必跑）
```bash
cd apps/web
npx tsc --noEmit      # 關 1
npx eslint <改過的檔>  # 關 2
npm run build         # 關 3（production build）
```
**Done 定義**：三關全綠 → 起 `npm run dev` 給使用者在 localhost 驗收 → 使用者說 OK → 才 commit+push（push main = Vercel 自動部署）。詳見 validation-and-qa.md。

## 事故：build 與 dev server 同時跑會互炸（2026-07-12 實際發生）
- **症狀**：`npm run build` 報 `npm error code ENOWORKSPACES` ＋ `Failed to patch lockfile` ＋ `TypeError: Cannot read properties of undefined (reading 'os')`。
- **原因**：dev server（port 3000）與 production build 共用 `.next/`，並行時互相破壞。
- **步驟**：`lsof -ti :3000 | xargs kill` → 等 1 秒 → 重跑 build → build 完再重啟 dev。
- ✅ 正例：`lsof -ti :3000 | xargs kill 2>/dev/null; sleep 1; npm run build`
- ❌ 反例：「build 錯誤看起來像 npm workspace 設定壞了，來改 package.json」— 當時第一反應就是這個，改設定完全是白工；先殺 dev server。

## 事故：ffmpeg 在 Vercel ENOENT（commit 3cda738）
`ffmpeg-static` 裝在 hoisted 根目錄，Vercel file tracing 追不到 → 音樂合成/FB 封面/發布/限動/排程 cron 五條 route 正式環境全掛。修法固定在 `apps/web/next.config.mjs` 的 `outputFileTracingIncludes`（同時列 `./node_modules` 與 `../../node_modules` 兩個 glob）。**新增任何會呼叫 ffmpeg 的 route，必須把該 route path 加進這個清單**，否則本機過、正式炸。

## 規則：`Array.from(new Set())`，永遠不用 `[...new Set()]`
Vercel build 的 TS target 會炸 spread-Set（歷史多次）。已寫進使用者的鐵則。

## 依賴安裝
在 `apps/web` 內 `npm install <pkg>` 可行（本 session 裝 `@anthropic-ai/claude-agent-sdk` 即如此），但會動到根目錄 `yarn.lock` — commit 時記得帶上 `yarn.lock` 與 `apps/web/package.json` 兩者。

## 從零重建
```bash
git clone <repo> && cd TM-contentloop && yarn install   # 或 npm install（會生 package-lock，別 commit）
cd apps/web && cp <備份>/.env.local .env.local           # user-must-provide：.env.local 不在 git
npm run dev
```
`.env.local` 內含 44 個環境變數（Firebase Admin、Meta、Anthropic、Gemini、Canva、CRON_SECRET…）— 遺失無法重建，只能向 owner 要。Vercel 環境變數用 `vercel env pull` 對照（repo 裡的 `.env.vercel*` 是某次 pull 的快照，未追蹤）。

再驗證：`cd apps/web && npx tsc --noEmit && npm run build`
