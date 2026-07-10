# AI 草稿背景音樂

## 背景

Meta 官方音樂曲庫（IG/FB App 內建的授權音樂）與 Canva 的 Stock Audio 都**不開放第三方 API**——查證 Canva Connect API 文件明確寫著「The assets APIs support images and videos」，音訊格式不在支援清單；Meta 同理。因此草稿加音樂只能靠「把音訊燒進媒體檔」再走既有的圖片/影片發布流程。

## Slice 1（2026-07-11）：音樂合成

`lib/media/composeAudio.ts` + `POST /api/content-drafts/media/compose`：

- 圖片 + 音檔 → server 端 ffmpeg 合成 12 秒 9:16 影片（模糊背景置中版面）
- 影片 + 音檔 → 取代原音軌（畫面不重編碼）
- 合成結果直接成為草稿媒體：預覽 = 發布內容（符合 HITL 單一事實來源原則）
- Composer UI：`AudioComposer.tsx`，上傳音檔（≤20MB）後自動合成，可「移除音樂」還原原始媒體
- 輪播不支援（Meta 輪播是多張相片，沒有單一影片可掛音軌）

## Slice 2（2026-07-11）：粉專曲庫

上傳一次、重複使用，不用每次做草稿都重新上傳同一首歌。

- **資料**：`pages/{pageId}/musicTracks/{id}`（page-scoped，符合跨頁隔離鐵則），欄位 `name` / `url` / `createdAt` / `byUid`
- **API**：`GET/POST/DELETE /api/content-drafts/music`（讀取與新增需 `content.draft`，刪除需 `content.publish`）
- **管理端**：廣告儀表板 → 品牌素材庫頁的 `MusicLibraryCard`（與既有 logo 素材卡同頁）——上傳、命名、試聽、刪除
- **選用端**：`AudioComposer` 內的 `MusicLibrary`（唯讀）——列出曲庫、試聽、選一首直接送去合成；曲庫空時提示到品牌素材庫上傳
- 音檔本體存 Firebase Storage（沿用既有 `uploads/{uid}` 上傳路徑與 rules，無需另外部署 storage rules）

## 版權提醒

僅限免版稅或自有音樂——版權歌曲會被 Meta Rights Manager 偵測並靜音或限流。UI 各處均有提示文字。

## 已知限制（ffmpeg 正式環境踩坑，2026-07-11）

Vercel 的 output file tracing 只追蹤 JS import，追不到 `ffmpeg-static` 的二進位執行檔（加上 monorepo workspaces 把套件裝在 repo 根目錄 node_modules），導致正式環境 `spawn .../ffmpeg-static/ffmpeg ENOENT`，本機開發因為有完整 node_modules 而不會發現。修法：`next.config.mjs` 用 `experimental.outputFileTracingIncludes` 為每一條會 spawn ffmpeg 的 route 明確宣告要打包（音樂合成、FB 封面截圖、發布、FB 限動補發、排程 cron 共 5 條）。之後任何新增會呼叫 ffmpeg 的 route 都要記得加進這個清單。
