# AI 草稿限動發布策略

## 背景

ContentLoop 的 AI 草稿可勾選「同時發佈限動 Story」。發布流程會先發布主貼，再用同一份媒體建立 FB / IG Story。Story 發布失敗不會讓主貼失敗，但會回寫 `storyNote`。

## 2026-07-10 FB Story 黑畫面事件

觀察到一則 FB Page Story 在 Meta Graph API 回傳 `published`，粉專身份與部分管理者帳號可正常觀看，但多個一般個人帳號看到黑畫面。檢查結果：

- 草稿為 carousel，`alsoStory=true`
- FB Story 使用 `generated.mediaUrl ?? generated.mediaUrls[0]`，也就是輪播第一張主貼圖片
- 原圖為橫式 JPEG `1054x791`
- Meta `/stories` edge 回傳 `post_id`、`media_id`、`status=published`
- `media_id` 圖片物件可由 Page token 讀取，尺寸仍是 `1054x791`

判斷：這不是主貼發布失敗，也不是單一使用者快取問題，而是 FB Page Story viewer 對 API 建立的圖片 Story 有不穩定渲染風險。API success 只能證明 Story shell 建立成功，不能保證所有一般 viewer 的手機端正常顯示媒體。第一次修復曾改成 9:16 JPEG 後走 `photo_stories`，但一般 viewer 仍可能看到黑畫面，因此改避開 `photo_stories`。

### 待驗證假設：Meta App Development mode / App Role 可見性

2026-07-10 後續測試顯示，FB Story 已改走 `video_stories`，且 MP4 也改為較保守的手機相容規格後，Meta Graph 仍回傳：

- `POST /api/content-drafts/{id}/fb-story`：`200`
- `/{pageId}/stories`：最新 Story `status=published`
- `media_type=video`
- `post_id`、`media_id`、Story URL 都有產生

但多個一般個人帳號仍看到黑畫面。此時格式問題的機率下降，下一個主要假設是：

> ContentLoop 的 Meta App 仍在 Development mode，FB Story API 發出的 Story 可能只有 Meta App role（Admin / Developer / Tester）能完整渲染；非 App role 的一般 viewer 可能只看到 Story shell 或黑畫面。

注意：ContentLoop 內的 `owner` / `admin` / `editor` / `viewer` 權限不等於 Meta Developer 後台的 App role。

已確認的對照事實（2026-07-10）：同一個 Development mode app 發出的內容，可見性並不一致 ——

- FB 主貼：所有人看得到
- IG Story：一般 viewer（非 App role）看得到，已實測確認
- FB Story：只有發布者（Meta App Admin）看得到，其他一般帳號黑畫面

因此這個限制（或渲染問題）是 FB Story surface 特有，不是 dev mode 對所有內容的全面封鎖；也不需要連 IG Story 一起停用。

**2026-07-11 追加：FB 影片（Reels）在 dev mode 下對一般人完全不可見。** 完整對照實驗（同一支影片、同一粉專）：

| 發布方式 | 一般 viewer 可見 |
|---|---|
| ContentLoop API `POST /{pageId}/videos`（FB 自動轉 Reel） | ❌ 不可見，且數小時後被整個移除（API 也查不到） |
| ContentLoop 同 token 走官方 `POST /{pageId}/video_reels` resumable flow | ❌ 只有發布者/App role 看得到 |
| Meta Business Suite 手動上傳同一支影片 | ✅ 所有人看得到 |

已排除：音樂版權（Business Suite 傳同檔可見）、檔案格式（IG 同檔正常）、端點差異（兩個端點都不行）。結論＝**dev mode App 透過 API 發的 FB 影片內容一律被壓制**，與 FB Story 黑畫面同族。注意 FB 會把粉專影片一律轉成 Reel（`permalink /reel/…`），且新 Reel 會自動出現在限動列（story tray）——一開始誤判成「FB Story 又被發出」或「IG 轉發」，其實是同一支被壓制的 Reel。

**過渡對策（FB 封面截圖 fallback）**：影片草稿（含圖＋音樂合成的）目標含 FB 時，composer 顯示 `FbCoverPicker`——使用者從影片截一張封面 JPEG（`generated.fbCoverImageUrl`，`/api/content-drafts/media/frame` + ffmpeg），發布時 FB 改發**圖片貼文**（一般人看得到），IG/Threads 照發完整音樂影片。不截圖則 FB 照發影片（僅測試者可見，UI 有警告）。

驗證方式：

1. 選一位目前看得到黑畫面的 Facebook 個人帳號。
2. 到 Meta Developer 後台把該帳號加入 ContentLoop app 的 Tester（或 Developer/Admin）。
3. 請對方接受 app role 邀請。
4. 請對方重新查看同一則 Story，或補發一則新的 FB Story 後再看。
5. 若加入 App role 後黑畫面消失，即可確認是 Development mode / App role 可見性限制。
6. 若仍黑畫面，才繼續排查 Story API 本身、粉專 Story 分享設定、Meta client cache 或帳號分眾限制。

長期解法應是讓 Meta App 完成 App Review 並切到 Live mode；目前不要把 FB Story API 對一般 viewer 的顯示結果視為已正式驗證。

## 修復策略

FB 圖片 Story 不再直接使用主貼原圖，也不再走 `photo_stories`。發布前一律：

1. 下載原始圖片
2. 用 `sharp` 產生 `1080x1920` 9:16 JPEG
3. 背景使用原圖 cover + blur / darken
4. 前景使用原圖 contain 置中
5. 用 `ffmpeg-static` 把 JPEG 轉成 6 秒 MP4
6. 上傳 JPEG 與 MP4 到 Firebase Storage `generated/fb-stories/{pageId}/...`
7. 用 MP4 URL 呼叫 `/{pageId}/video_stories`

IG Story 仍沿用原流程；Threads 沒有 Story。

## FB Story／FB 影片開關（Development mode 期間限制）

在 Meta App 完成 App Review 切到 Live mode 之前：FB Story 發布整體停用（2026-07-10）、FB 影片改走封面圖 fallback（2026-07-11）。IG／Threads 不受影響。

- **統一開關**：`NEXT_PUBLIC_META_APP_LIVE`（單一事實來源 `lib/content/fbStoryFlag.ts`）。未設定＝dev mode 限制生效；**go live 後設為 `1`，FB Story 與 FB 完整影片（含音樂）一次恢復**，封面圖欄位備而不用，舊草稿與排程草稿都不用改。舊變數 `NEXT_PUBLIC_FB_STORY_ENABLED` 仍可單獨重開 Story（向後相容）。
- **UI**（`DraftComposer`）：只選 FB 時限動勾選 disabled；FB+IG 時仍可勾但只發 IG，並顯示琥珀色說明「FB 限動暫停發布」。
- **Server**（`publishRunner.runPublish`）：FB 平台遇到 `alsoStory=true` 一律跳過 Story 並回 `storyNote` 說明——涵蓋排程中、開關生效前建立的舊草稿，主貼照常發布。
- **補發 FB 限動**：UI 按鈕在停用期間**整顆隱藏**（跟 flag 連動，重開後自動回來且僅 owner 可見）；API repair path 保留 owner-only 可直接呼叫——留給 Tester 驗證與上線後補發歷史 Story 使用。

## 已發布草稿的補發限動

若 FB 主貼已發布，但 Story 需要修復或重發，不能把草稿退回再按一般發布，否則會有重發主貼風險。ContentLoop 提供獨立的「補發 FB 限動」動作：

1. 只允許在 FB 主貼已有 `publishResults.fb.postId` 時使用
2. 只讀原草稿的 `generated.mediaUrl ?? generated.mediaUrls[0]`
3. 只呼叫 `publishFbStory`
4. 保留原本 `publishResults.fb.postId` / `permalink`
5. 只更新 `publishResults.fb.storyId` 與 audit log

這個 repair path 不會呼叫 `publishToFacebook`，也不會更動 IG / Threads。

## 產品限制

- carousel 勾選 Story 時，FB / IG Story 只使用第一個媒體。
- FB 影片 Story 直接走 `video_stories` resumable flow；FB 圖片 Story 會先轉成短 MP4 再走同一條 flow。
- FB 圖片 Story 轉出的 MP4 使用保守規格：H.264 Constrained Baseline、`yuv420p`、`bt709`、`1080x1920`、silent AAC audio、`+faststart`。
- 若 9:16 圖片或 MP4 轉換失敗，FB Story 會失敗並寫入 `storyNote`，主貼仍保留成功狀態。
