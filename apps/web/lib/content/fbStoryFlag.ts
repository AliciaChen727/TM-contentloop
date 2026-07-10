// Meta App Live 開關（單一事實來源，client/server 共用）。
//
// Meta App 在 Development mode 期間，API 發布的部分 FB 內容只有 App role
// （Admin/Dev/Tester）看得到，一般觀眾看不到（實測 2026-07-10~11，詳見
// docs/content-draft-story-publishing.md）：
// - FB Page Story：黑畫面（video_stories/photo_stories 都一樣）
// - FB 影片（/videos 與 /video_reels 都被轉成 Reel）：完全不可見，甚至事後被移除
// - FB 文字/圖片/輪播、IG 全線、Threads：正常
//
// App Review 通過切 Live mode 後，把 NEXT_PUBLIC_META_APP_LIVE 設為 '1' 即可
// 一次恢復（FB Story + FB 影片），不需改程式。舊變數 NEXT_PUBLIC_FB_STORY_ENABLED
// 仍可單獨重開 FB Story（向後相容）。owner 的「補發 FB 限動」repair API 不受
// 開關限制，保留給 Tester 驗證與上線後補發使用。

const flag = (v: string | undefined) => v === '1' || v === 'true'

export const META_APP_LIVE = flag(process.env.NEXT_PUBLIC_META_APP_LIVE)

export const FB_STORY_ENABLED = META_APP_LIVE || flag(process.env.NEXT_PUBLIC_FB_STORY_ENABLED)

export const FB_VIDEO_ENABLED = META_APP_LIVE

export const FB_STORY_DISABLED_NOTE =
  'FB 限動暫停發布：Meta App 尚在開發模式，一般觀眾會看到黑畫面，待審核上線後開放'

export const FB_VIDEO_DEV_NOTE =
  'Meta App 尚在開發模式，FB 影片（Reel）僅 App 測試者可見，一般觀眾看不到'
