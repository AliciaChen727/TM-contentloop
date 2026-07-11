// Firestore tool layer for tool-use agents (Phase 3B, Slice 15).
// Every tool executor validates pageId against a server-resolved whitelist
// (ToolContext.allowedPageIds) — the model can NEVER read a page outside it,
// regardless of what it puts in the tool arguments. See
// docs/phase-3b-agent-tooling.md §3 and CLAUDE.md 多粉專資料隔離鐵則.

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'

export interface ToolContext {
  // Resolved server-side from the caller's identity (admins/viewerAccess) or
  // fixed to [pageId] for per-page batch jobs. Never taken from the client/model.
  allowedPageIds: string[]
}

const DENIED = 'ERROR: pageId 不在授權範圍內，無法查詢。請只使用輸入資料中提供的 pageId。'

function isAllowed(ctx: ToolContext, pageId: string): boolean {
  return ctx.allowedPageIds.includes(pageId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDateStr(v: any): string {
  if (!v) return ''
  if (typeof v === 'string') return v.slice(0, 10)
  if (typeof v?.toDate === 'function') return v.toDate().toISOString().slice(0, 10)
  return ''
}

// Compact JSON for tool results — keeps token cost down.
function j(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Build the page-data tools bound to one whitelist. Pass the result to
 * client.beta.messages.toolRunner({ tools }).
 */
export function buildPageDataTools(ctx: ToolContext) {
  const getAdInsights = betaTool({
    name: 'get_ad_insights',
    description:
      '查詢指定粉專的最新廣告成效快照：帳戶摘要（spend/reach/ctr/cpm/frequency/conversions/cpa/roas）、日期區間、每日趨勢（最近 14 天）、素材列表（前 8 筆）。用於核對數字或觀察趨勢。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '粉專 ID（必須來自輸入資料）' },
      },
      required: ['pageId'],
      additionalProperties: false,
    } as const,
    run: async ({ pageId }) => {
      if (!isAllowed(ctx, pageId)) return DENIED
      const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data()
      if (!snap) return 'ERROR: 此粉專沒有廣告快照資料。'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creatives = (Array.isArray(snap.adCreatives) ? snap.adCreatives : []).slice(0, 8).map((c: any) => ({
        name: c.name ?? c.title ?? '', status: c.status ?? '',
        spend: c.spend ?? null, ctr: c.ctr ?? null, cpc: c.cpc ?? null,
        impressions: c.impressions ?? null, clicks: c.clicks ?? null,
      }))
      const daily = (Array.isArray(snap.daily) ? snap.daily : []).slice(-14)
      return j({
        syncedAt: toDateStr(snap.syncedAt),
        dateRange: snap.dateRange ?? null,
        summary: snap.summary ?? null,
        daily,
        adCreatives: creatives,
        diagnosisCounts: snap.diagnosisCounts ?? null,
      })
    },
  })

  const getPosts = betaTool({
    name: 'get_posts',
    description:
      '查詢指定粉專最近的 FB 或 IG 貼文（自然觸及與互動：reach/likes/comments/shares）。用於判斷素材方向、對照廣告與自然貼文表現。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '粉專 ID（必須來自輸入資料）' },
        platform: { type: 'string', enum: ['fb', 'ig'], description: 'fb 或 ig' },
        limit: { type: 'number', description: '筆數上限（1–20，預設 10）' },
      },
      required: ['pageId', 'platform'],
      additionalProperties: false,
    } as const,
    run: async ({ pageId, platform, limit }) => {
      if (!isAllowed(ctx, pageId)) return DENIED
      const ownerUid = await resolvePageOwnerUid(pageId)
      if (!ownerUid) return 'ERROR: 找不到此粉專的資料擁有者。'
      const n = Math.min(Math.max(Math.round(limit ?? 10), 1), 20)
      const pageRef = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)

      // ISOLATION: page-scoped reads only. (FB legacy would need `${pageId}_`
      // prefix filtering; page-scoped is canonical since the sync rewrite, so
      // tools do not read legacy collections at all.)
      if (platform === 'fb') {
        const snap = await pageRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(n).get()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return j(snap.docs.map((doc) => { const d = doc.data() as any; const ins = d.insights ?? {}; return {
          date: toDateStr(d.createdTime), text: String(d.message ?? '').slice(0, 120),
          reach: ins.reach ?? null, likes: ins.reactions ?? 0, comments: ins.comments ?? 0, shares: ins.shares ?? 0,
        } }))
      }
      const snap = await pageRef.collection('igPosts').orderBy('timestamp', 'desc').limit(n).get()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return j(snap.docs.map((doc) => { const d = doc.data() as any; const ins = d.insights ?? {}; return {
        date: toDateStr(d.timestamp), text: String(d.caption ?? '').slice(0, 120), mediaType: d.mediaType ?? '',
        reach: ins.reach ?? null, likes: ins.likes ?? 0, comments: ins.comments ?? 0, saves: ins.saved ?? 0, shares: ins.shares ?? 0,
      } }))
    },
  })

  const getFeedbackMemory = betaTool({
    name: 'get_feedback_memory',
    description:
      '查詢此粉專過去 AI 建議的成效記憶：哪些建議被人類採用（humanAction=adopted）、品質評分（evalScore 1–10）與最終採用文字。用於對齊過去被驗證有效的方向。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '粉專 ID（必須來自輸入資料）' },
        source: { type: 'string', enum: ['sidekick', 'diagnosis', 'creative'], description: '來源篩選（可省略）' },
        limit: { type: 'number', description: '筆數上限（1–15，預設 8）' },
      },
      required: ['pageId'],
      additionalProperties: false,
    } as const,
    run: async ({ pageId, source, limit }) => {
      if (!isAllowed(ctx, pageId)) return DENIED
      const n = Math.min(Math.max(Math.round(limit ?? 8), 1), 15)
      // Recent-first fetch + in-memory source filter — same pattern as
      // feedbackRetrieval.ts, avoids a where+orderBy composite index.
      const snap = await adminDb.collection('pages').doc(pageId).collection('sidekickFeedback')
        .orderBy('createdAt', 'desc').limit(60).get()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = snap.docs.map((doc) => doc.data() as any)
        .filter((d) => !source || d.source === source)
        .map((d) => ({
          alertType: d.alertType ?? null, humanAction: d.humanAction ?? null,
          evalScore: d.evalScore ?? null,
          text: String(d.adoptedText ?? d.output ?? '').slice(0, 200),
        }))
        .filter((r) => r.text)
        .slice(0, n)
      return j(rows)
    },
  })

  return [getAdInsights, getPosts, getFeedbackMemory]
}
