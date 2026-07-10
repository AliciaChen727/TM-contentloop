// FB Story 發布開關（單一事實來源，client/server 共用）。
//
// Meta App 在 Development mode 期間，API 建立的 FB Page Story 對沒有 App role
// 的一般觀眾會渲染成黑畫面（FB 主貼與 IG Story 不受影響，已實測；詳見
// docs/content-draft-story-publishing.md）。在 App Review 通過、切到 Live mode
// 之前，FB Story 發布一律關閉；上線後把 NEXT_PUBLIC_FB_STORY_ENABLED 設為 '1'
// 即可重開，不需改程式。owner 的「補發 FB 限動」repair path 不受此開關限制，
// 保留給 Tester 驗證與上線後補發使用。
export const FB_STORY_ENABLED =
  process.env.NEXT_PUBLIC_FB_STORY_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_FB_STORY_ENABLED === 'true'

export const FB_STORY_DISABLED_NOTE =
  'FB 限動暫停發布：Meta App 尚在開發模式，一般觀眾會看到黑畫面，待審核上線後開放'
