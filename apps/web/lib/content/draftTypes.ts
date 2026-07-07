// Content-draft types + state machine (Agent 自動發布 S1). Pure — no firebase
// imports so both server (draftStore) and client (S2 審核 UI) can share it.
// See docs/agent-auto-publish-plan.md §5–§7.

export type DraftTarget = 'fb' | 'ig' | 'th'
export type MediaType = 'text' | 'image' | 'carousel' | 'video' | 'reels' | 'story'

export type DraftStatus =
  | 'draft'        // Agent 產出、待人審
  | 'approved'     // Admin 核准，待發布
  | 'scheduled'    // 已核准且排定時間（L2）
  | 'publishing'   // 正在寫入 Meta
  | 'processing'   // 影片容器建立中／等 Meta 轉檔（輪詢 status_code）
  | 'published'    // 發布成功
  | 'failed'       // 生成或發布失敗（保留 error，不靜默）
  | 'rejected'     // Admin 拒絕
  | 'expired'      // 核准逾時未發，需重審

// One platform's adapted copy (字數/尺寸已符合該平台上限，S3 驗證)。
export interface PerPlatformContent {
  body: string
  hashtags?: string[]     // IG ≤ 30
  mediaUrl?: string       // 平台可各自用不同素材
}

export interface DraftRecommendation {
  device: 'mobile' | 'desktop' | 'mixed'
  format: string          // 例：'直式 4:5' / '9:16 Reels'
  why: string
}

export interface GeneratedContent {
  prompt?: string                                   // 生成 prompt（可追溯）
  mediaUrl?: string                                 // 主素材（圖/影片，影片/Reels 用 9:16）
  aspectRatio?: string
  perPlatform: Partial<Record<DraftTarget, PerPlatformContent>>
  recommendation?: DraftRecommendation
  alsoStory?: boolean                               // 同時把媒體發成限動 Story（IG/FB，時效性）
}

export interface ContentDraft {
  id: string
  pageId: string
  target: DraftTarget[]                             // 可多選同時發
  mediaType: MediaType
  generated: GeneratedContent
  schedule?: { mode: 'now' | 'scheduled'; at?: number }
  status: DraftStatus
  createdByUid: string
  approvedByUid?: string | null
  publishResult?: { postId?: string; error?: string } | null
  // Per-platform publish outcome (S4a+). Threads published first; FB/IG later.
  publishResults?: Partial<Record<DraftTarget, { postId?: string; permalink?: string; error?: string; at: number }>>
  idempotencyKey: string
  createdAt: number
  updatedAt: number
}

// Payload accepted by POST /api/content-drafts (create). Server fills the rest.
export interface CreateDraftInput {
  pageId: string
  target: DraftTarget[]
  mediaType: MediaType
  generated: GeneratedContent
  schedule?: { mode: 'now' | 'scheduled'; at?: number }
}

// State machine — the ONLY allowed transitions. Enforced server-side so the UI
// (or a buggy client) can never move a draft into an illegal state.
export const DRAFT_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  draft:      ['approved', 'rejected', 'expired'],
  approved:   ['scheduled', 'publishing', 'draft', 'rejected', 'expired'], // draft = 收回核准
  scheduled:  ['publishing', 'approved', 'rejected', 'expired'],
  publishing: ['processing', 'published', 'failed'],
  processing: ['published', 'failed'],
  published:  [],                                   // 終態
  failed:     ['draft'],                            // 允許重來
  rejected:   ['draft'],                            // 允許復原
  expired:    ['draft'],                            // 重審
}

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return DRAFT_TRANSITIONS[from]?.includes(to) ?? false
}

// Transitions a human (S1/S2 審核) may drive directly; publish-side states
// (publishing/processing/published/failed) are set by the发布流程, not the UI.
export const HUMAN_DRIVEN_STATUSES: DraftStatus[] = ['approved', 'rejected', 'draft', 'expired']

export function isValidTarget(t: unknown): t is DraftTarget {
  return t === 'fb' || t === 'ig' || t === 'th'
}
export function isValidMediaType(m: unknown): m is MediaType {
  return ['text', 'image', 'carousel', 'video', 'reels', 'story'].includes(m as string)
}
