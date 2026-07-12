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
  // Optional display names (pageId → name) for cross-page comparison output.
  pageNames?: Record<string, string>
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
      // Per-post ad metrics are page-prefix-filtered across ALL ad accounts →
      // more complete than the account-level summary when a page's campaigns
      // span multiple accounts (known sync limitation, fix tracked separately).
      const toRows = (m: unknown) => Object.entries((m ?? {}) as Record<string, { spend?: number; ctr?: number; cpa?: number; roas?: number; reach?: number }>)
        .map(([postId, v]) => ({ postId, text: '', url: '', spend: v.spend ?? 0, ctr: v.ctr ?? null, cpa: v.cpa ?? null, roas: v.roas ?? null, reach: v.reach ?? null }))
        .filter((r) => r.spend > 0)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10)
      const promotedPosts = toRows(snap.adPostMetrics)
      const promotedIgPosts = toRows(snap.igPostMetrics)
      // Attach the post text so answers can reference posts by content, never by
      // raw ID (raw IDs are meaningless to users). Best-effort, page-scoped only.
      try {
        const ownerUid = await resolvePageOwnerUid(pageId)
        if (ownerUid) {
          const pageRef = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)
          await Promise.all([
            ...promotedPosts.map(async (r) => {
              const doc = await pageRef.collection('fbPosts').doc(`${pageId}_${r.postId}`).get()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const d = doc.data() as any
              r.text = String(d?.message ?? '').slice(0, 80)
              r.url = String(d?.permalink ?? '')
            }),
            ...promotedIgPosts.map(async (r) => {
              const doc = await pageRef.collection('igPosts').doc(r.postId).get()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const d = doc.data() as any
              r.text = String(d?.caption ?? '').slice(0, 80)
              r.url = String(d?.permalink ?? '')
            }),
          ])
        }
      } catch { /* text enrichment is best-effort */ }
      return j({
        syncedAt: toDateStr(snap.syncedAt),
        dateRange: snap.dateRange ?? null,
        summary: snap.summary ?? null,
        summaryCaveat: 'summary/daily 是「近 30 天」滾動窗口（每日凌晨更新）。spend=0 代表近 30 天沒有投放，是正常狀態、不是同步異常，不要說資料異常。歷史戰役（含已結束的）看 promotedPosts / promotedIgPosts（90 天、跨帳號、已按粉專過濾）。提及貼文時用 text 內容描述並附 url 的 markdown 連結，不要念 postId。',
        daily,
        adCreatives: creatives,
        promotedPosts: toRows(snap.adPostMetrics),
        promotedIgPosts: toRows(snap.igPostMetrics),
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
          date: toDateStr(d.createdTime), text: String(d.message ?? '').slice(0, 120), url: String(d.permalink ?? ''),
          reach: ins.reach ?? null, likes: ins.reactions ?? 0, comments: ins.comments ?? 0, shares: ins.shares ?? 0,
        } }))
      }
      const snap = await pageRef.collection('igPosts').orderBy('timestamp', 'desc').limit(n).get()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return j(snap.docs.map((doc) => { const d = doc.data() as any; const ins = d.insights ?? {}; return {
        date: toDateStr(d.timestamp), text: String(d.caption ?? '').slice(0, 120), url: String(d.permalink ?? ''), mediaType: d.mediaType ?? '',
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

  const comparePages = betaTool({
    name: 'compare_pages',
    description:
      '跨粉專比較：一次取回多個「使用者有權限的」粉專資料供並列比較。summary=近 30 天帳戶層（spend 0 = 近期沒投放，非異常）；promoted90d=近 90 天貼文層廣告（跨帳號、含已結束戰役）——比較歷史投放（如「近90日」「五月」）一律用 promoted90d。僅限使用者明示要求跨粉專分析時使用；結果絕不寫回任何粉專。',
    inputSchema: {
      type: 'object',
      properties: {
        pageIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 5,
          description: '要比較的粉專 ID（必須全部在授權清單內）',
        },
      },
      required: ['pageIds'],
      additionalProperties: false,
    } as const,
    run: async ({ pageIds }) => {
      const denied = pageIds.filter((p) => !isAllowed(ctx, p))
      if (denied.length > 0) return DENIED
      const rows = await Promise.all(pageIds.map(async (pid) => {
        const snap = (await adminDb.collection('pages').doc(pid).collection('adInsights').doc('latest').get()).data()
        // 90d post-level ads (cross-account, page-filtered) — the comparable
        // signal for historical/finished campaigns; summary is last-30d only.
        type Pm = { spend?: number; ctr?: number; cpa?: number }
        const all = [
          ...Object.entries((snap?.adPostMetrics ?? {}) as Record<string, Pm>).map(([id, v]) => ({ id, fb: true, ...v })),
          ...Object.entries((snap?.igPostMetrics ?? {}) as Record<string, Pm>).map(([id, v]) => ({ id, fb: false, ...v })),
        ].filter(p => (p.spend ?? 0) > 0).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
        const spend90 = all.reduce((s, p) => s + (p.spend ?? 0), 0)
        const wCtr = spend90 > 0 ? all.reduce((s, p) => s + (p.ctr ?? 0) * (p.spend ?? 0), 0) / spend90 : 0
        const top = all.slice(0, 3).map(p => ({ text: '', url: '', spend: Math.round(p.spend ?? 0), ctr: p.ctr ?? null, cpa: p.cpa ?? null }))
        try {
          const ownerUid = await resolvePageOwnerUid(pid)
          if (ownerUid) {
            const pageRef = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pid)
            await Promise.all(all.slice(0, 3).map(async (p, i) => {
              const doc = p.fb
                ? await pageRef.collection('fbPosts').doc(`${pid}_${p.id}`).get()
                : await pageRef.collection('igPosts').doc(p.id).get()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const d = doc.data() as any
              top[i].text = String((p.fb ? d?.message : d?.caption) ?? '').slice(0, 60)
              top[i].url = String(d?.permalink ?? '')
            }))
          }
        } catch { /* best-effort */ }
        return {
          pageId: pid,
          pageName: ctx.pageNames?.[pid] ?? '',
          syncedAt: snap ? toDateStr(snap.syncedAt) : null,
          dateRange: snap?.dateRange ?? null,
          summary: snap?.summary ?? null,
          promoted90d: { postCount: all.length, spend: Math.round(spend90), avgCtrSpendWeighted: +wCtr.toFixed(2), topPosts: top },
        }
      }))
      return j({ note: 'summary=近30天（0=近期沒投放，非異常）；歷史/90日比較用 promoted90d；提及貼文用 text+url，不念 ID。', pages: rows })
    },
  })

  // compare_pages only makes sense with 2+ authorized pages (schema minItems: 2).
  return ctx.allowedPageIds.length >= 2
    ? [getAdInsights, getPosts, getFeedbackMemory, comparePages]
    : [getAdInsights, getPosts, getFeedbackMemory]
}
