// Per-platform hard limits (Agent 自動發布 S3). Pure constants — the single
// source of truth for validateDraft, the composer's inline checks, and the
// publish-time guard. Numbers per docs/agent-auto-publish-plan.md §5.5.

import type { DraftTarget } from '@/lib/content/draftTypes'

export interface PlatformSpec {
  textMax: number            // hard character cap for the caption
  hashtagMax: number | null  // max hashtags (null = no hard cap)
  mediaRequired: boolean     // must a post carry media?
  allowsTextOnly: boolean    // can it be a text-only post?
  autoSplit: boolean         // long text splits into a reply chain (Threads)
}

export const PLATFORM_SPECS: Record<DraftTarget, PlatformSpec> = {
  // FB: effectively no text cap; text-only allowed; no hard hashtag cap.
  fb: { textMax: 63206, hashtagMax: null, mediaRequired: false, allowsTextOnly: true, autoSplit: false },
  // IG: caption ≤2,200, ≤30 hashtags, and NO text-only posts (media required).
  ig: { textMax: 2200, hashtagMax: 30, mediaRequired: true, allowsTextOnly: false, autoSplit: false },
  // Threads: 500/post but overflow auto-splits into a reply chain (not a violation).
  th: { textMax: 500, hashtagMax: null, mediaRequired: false, allowsTextOnly: true, autoSplit: true },
}
