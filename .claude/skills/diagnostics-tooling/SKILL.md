---
name: diagnostics-tooling
description: 載入時機（觀察到的狀態）：需要直接檢查/修改正式 Firestore 的資料（快照對照、清測試資料、倒填欄位）、臨時腳本報 ERR_MODULE_NOT_FOUND、或要打有 auth 的內部 API。
---

# 診斷腳本工具箱（驗證日 2026-07-13）

## 標準模式：throwaway 腳本直讀正式 Firestore
本 repo 的資料排錯不靠 console 點來點去，靠臨時腳本。骨架（實戰驗證多次）：
```js
// inspect-xxx-tmp.mjs — 放 apps/web/ 下執行
import admin from 'firebase-admin'; import fs from 'node:fs'
const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}
admin.initializeApp({ credential: admin.credential.cert({
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
}) })
const db = admin.firestore()
// ... 查詢/寫入 ...
process.exit(0)   // 必加：admin SDK 會讓 process 掛著不結束
```

## 四個坑（每個都踩過）
1. **執行位置**：腳本必須放在 repo 樹內（慣例：`apps/web/`）執行 — node 才解析得到 hoisted 根目錄 `node_modules` 的 firebase-admin。放外部目錄（如 scratchpad）→ `ERR_MODULE_NOT_FOUND`。用完 `rm`。
2. **引號**：`.env.local` 的值多帶雙引號，`privateKey` 還有 `\\n` — 上面骨架的兩個 replace 都是必要的。
3. **TS 腳本**：要 import repo 的 lib（如 `./lib/bugs/bugReporter`）就寫 `.mts` 用 `npx tsx xxx.mts` 跑（tsx 未裝在 repo，npx 會臨時抓）。純查詢用 `.mjs` + `node` 就好。
4. **Timestamp**：比較用 `toMillis()`，顯示用 `?.toDate?.()?.toISOString?.()`（欄位可能缺）。

## 常用檢查腳本（照抄改 pageId 即可）
- **三層廣告快照對照**（debugging-ads-data.md 的第一步）：dump `users/{uid}/pages/{pid}/adInsights/latest`、`pages/{pid}/adAccountSnapshots/*`、`pages/{pid}/adInsights/latest` 的 syncedAt/dateRange/dailyCount/spend。
- **頁名對照**：掃所有 users 的 `metaTokens` 建 pageId→pageName 表（2026-07-12 時：Legacy=235543696463178、D67=874392279086513，另有 4 頁）。
- **清測試資料**：凡合成資料都帶標記（如 `source:'e2e_test'`），清理用 `where('source','==','e2e_test')` 掃 + 連帶清鈴鐺通知（`users/{uid}/notifications` where pageName）+ 關 GitHub Issue。

## 打內部 API
- cron 端點：`Authorization: Bearer $CRON_SECRET`（引號陷阱見 cron-operations.md），可打 localhost 或正式站。
- 使用者端點（`verifyIdToken`）：**沒有**服務端造 token 的捷徑 — 要嘛用瀏覽器實測，要嘛直接 import lib 函式繞過 route 層測邏輯。
- 寫入類操作動正式資料前：先 dump 現狀留檔，並告知使用者要動什麼。

## Firestore 查詢慣例
- 避免 `where`+`orderBy` 組合（composite index）— 用 orderBy limit 撈近期 + 記憶體過濾（repo 全面如此）。
- `set(..., {merge:true})` 是**深合併**：歸零一個 map 要列出全部 key，漏的 key 舊值殘留（linkClicks 事故）。
- collectionGroup 查詢可用（`metaTokens`、`threadsTokens` 有前例）。

再驗證：`cd apps/web && node -e "import('firebase-admin').then(()=>console.log('resolvable'))"`
