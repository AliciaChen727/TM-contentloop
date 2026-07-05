export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

const BASE = 'https://graph.facebook.com/v21.0'
const DAY = 86400000
const MAX_DAYS = 400            // daily-series bar cap (avoid runaway for 全部/自訂)
const MAX_CONV_PAGES = 5        // pagination safety cap
const CONV_LIMIT = 50           // conversations per page
const MSG_LIMIT = 100           // recent messages expanded per conversation (accuracy vs payload)

// Phase 5-1 私訊分析（唯讀）：即時列舉 IG/FB 對話算統計，不存原文（隱私最小化）。
// 需要 instagram_manage_messages / pages_messaging scope（開發模式下 admin 可直接用）。

type RawFrom = { id?: string; name?: string; username?: string }
type RawMsg = { created_time?: string; from?: RawFrom }
type RawConv = {
  id: string
  updated_time?: string
  message_count?: number
  participants?: { data?: RawFrom[] }
  messages?: { data?: RawMsg[] }
}

interface PlatformStat {
  available: boolean
  error?: string
  conversations: number
  inboundMessages: number
  uniqueSenders: number
}
interface RecentItem { platform: 'IG' | 'FB'; name: string; lastTime: string | null; messageCount: number }
interface DailyPoint { date: string; fbMsg: number; igMsg: number; fbUsers: number; igUsers: number }
interface InboundMsg { platform: 'IG' | 'FB'; convId: string; fromId: string | null; timeMs: number | null }

function dateKeyTaipei(iso: string): string {
  // Bucket by the user's local day (TM chapter is in Taiwan).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

// Hour-of-day (0–23) in Taipei time, for the peak-hours histogram.
function hourTaipei(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }).format(new Date(ms)).slice(0, 2)) % 24
}

async function fetchConversations(
  pageId: string, platform: 'messenger' | 'instagram', token: string,
): Promise<{ convs: RawConv[]; error?: string }> {
  const convs: RawConv[] = []
  const first = new URL(`${BASE}/${pageId}/conversations`)
  first.searchParams.set('platform', platform)
  first.searchParams.set('fields', `updated_time,message_count,participants,messages.limit(${MSG_LIMIT}){created_time,from}`)
  first.searchParams.set('limit', String(CONV_LIMIT))
  first.searchParams.set('access_token', token)
  let next: string | null = first.toString()
  let page = 0
  while (next && page < MAX_CONV_PAGES) {
    try {
      const r: Response = await fetch(next)
      const d = await r.json()
      if (!r.ok || d.error) return { convs, error: d.error?.message ?? 'conversations fetch failed' }
      convs.push(...((d.data ?? []) as RawConv[]))
      next = d.paging?.next ?? null
      page++
    } catch (e) {
      return { convs, error: e instanceof Error ? e.message : 'conversations fetch exception' }
    }
  }
  return { convs }
}

// Collect inbound (non-page) messages with timestamps + build the recent-conversation
// list. Windowing/bucketing happens in the handler so the date range can vary.
// ownIds = the page's own participant ids (so we can tell inbound from outbound).
function collectInbound(
  convs: RawConv[], platform: 'IG' | 'FB', ownIds: Set<string>, recent: RecentItem[],
): InboundMsg[] {
  const out: InboundMsg[] = []
  for (const c of convs) {
    // Participant name that isn't the page itself → the person messaging us.
    const other = (c.participants?.data ?? []).find(p => p.id && !ownIds.has(p.id))
    recent.push({
      platform,
      // Empty when Meta doesn't expose the sender's name → the client shows a
      // platform-specific fallback label instead of a raw "(unknown)".
      name: other?.name ?? other?.username ?? '',
      lastTime: c.updated_time ?? null,
      // message_count is often 0/absent on IG → fall back to the messages we
      // actually fetched so the column isn't misleadingly zero.
      messageCount: c.message_count || (c.messages?.data?.length ?? 0),
    })
    for (const m of c.messages?.data ?? []) {
      const fromId = m.from?.id ?? null
      if (fromId && ownIds.has(fromId)) continue // outbound (our own reply)
      out.push({ platform, convId: c.id, fromId, timeMs: m.created_time ? new Date(m.created_time).getTime() : null })
    }
  }
  return out
}

// Resolve the [startMs, endMs] window from the range params.
function resolveWindow(range: string, since: string | null, until: string | null, inbound: InboundMsg[]) {
  const now = Date.now()
  let endMs = now
  let startMs: number
  if (range === 'custom' && since) {
    startMs = Date.parse(`${since}T00:00:00+08:00`)
    endMs = until ? Date.parse(`${until}T23:59:59+08:00`) : now
  } else if (range === '90d') {
    startMs = now - 90 * DAY
  } else if (range === 'all') {
    const times = inbound.map(m => m.timeMs).filter((t): t is number => t != null)
    startMs = times.length ? times.reduce((a, b) => Math.min(a, b), now) : now - 30 * DAY
  } else {
    startMs = now - 30 * DAY // default 30d
  }
  if (!Number.isFinite(startMs)) startMs = now - 30 * DAY
  if (!Number.isFinite(endMs)) endMs = now
  if (endMs - startMs > MAX_DAYS * DAY) startMs = endMs - MAX_DAYS * DAY // cap series length
  return { startMs, endMs }
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // pageId isolation: admin reads own token; viewer must be granted this page.
  let dataOwnerUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    const allowed = viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const ownerUid = await resolvePageOwnerUid(pageId)
    if (!ownerUid) return NextResponse.json({ error: 'Page owner not found' }, { status: 404 })
    dataOwnerUid = ownerUid
  }

  const tokenSnap = dataOwnerUid === uid
    ? ownTokenSnap
    : await adminDb.collection('users').doc(dataOwnerUid).collection('metaTokens').doc(pageId).get()
  const tokenData = tokenSnap.data() as { accessToken?: string; igUserId?: string } | undefined
  const accessToken = tokenData?.accessToken
  const igUserId = tokenData?.igUserId
  if (!accessToken) return NextResponse.json({ error: 'No page access token' }, { status: 400 })

  const ownIds = new Set<string>([pageId, ...(igUserId ? [igUserId] : [])])
  const recent: RecentItem[] = []

  const [fbRes, igRes] = await Promise.all([
    fetchConversations(pageId, 'messenger', accessToken),
    fetchConversations(pageId, 'instagram', accessToken),
  ])

  const inbound = collectInbound(fbRes.convs, 'FB', ownIds, recent)
    .concat(collectInbound(igRes.convs, 'IG', ownIds, recent))

  const range = req.nextUrl.searchParams.get('range') ?? '30d'
  const since = req.nextUrl.searchParams.get('since')
  const until = req.nextUrl.searchParams.get('until')
  const { startMs, endMs } = resolveWindow(range, since, until, inbound)

  // Window + bucket per platform in one pass. `daily` holds per-day message
  // counts; `dayUsers` holds per-day distinct senders (for the 人數 lines).
  const daily = new Map<string, DailyPoint>()
  const dayUsers = new Map<string, Set<string>>() // key = `${dateKey}|${platform}`
  const windowStat = (platform: 'IG' | 'FB') => {
    const senders = new Set<string>()
    const convs = new Set<string>()
    let count = 0
    for (const m of inbound) {
      if (m.platform !== platform || m.timeMs == null || m.timeMs < startMs || m.timeMs > endMs) continue
      count++
      convs.add(m.convId)
      if (m.fromId) senders.add(m.fromId)
      const key = dateKeyTaipei(new Date(m.timeMs).toISOString())
      const pt = daily.get(key) ?? { date: key, fbMsg: 0, igMsg: 0, fbUsers: 0, igUsers: 0 }
      if (platform === 'IG') pt.igMsg++; else pt.fbMsg++
      daily.set(key, pt)
      if (m.fromId) {
        const uk = `${key}|${platform}`
        let s = dayUsers.get(uk)
        if (!s) { s = new Set<string>(); dayUsers.set(uk, s) }
        s.add(m.fromId)
      }
    }
    return { count, senders, convCount: convs.size }
  }
  const fbW = windowStat('FB')
  const igW = windowStat('IG')

  const fbStat: PlatformStat = {
    available: !fbRes.error, error: fbRes.error,
    conversations: fbW.convCount, inboundMessages: fbW.count, uniqueSenders: fbW.senders.size,
  }
  const igStat: PlatformStat = {
    available: !igRes.error, error: igRes.error,
    conversations: igW.convCount, inboundMessages: igW.count, uniqueSenders: igW.senders.size,
  }

  // Zero-filled daily series across the window, oldest→newest.
  const nDays = Math.min(MAX_DAYS, Math.max(1, Math.floor((endMs - startMs) / DAY) + 1))
  const dailySeries: DailyPoint[] = []
  for (let i = 0; i < nDays; i++) {
    const key = dateKeyTaipei(new Date(startMs + i * DAY).toISOString())
    const pt = daily.get(key) ?? { date: key, fbMsg: 0, igMsg: 0, fbUsers: 0, igUsers: 0 }
    pt.fbUsers = dayUsers.get(`${key}|FB`)?.size ?? 0
    pt.igUsers = dayUsers.get(`${key}|IG`)?.size ?? 0
    dailySeries.push(pt)
  }

  const allSenders = new Set<string>(Array.from(fbW.senders).concat(Array.from(igW.senders)))
  recent.sort((a, b) => (b.lastTime ?? '').localeCompare(a.lastTime ?? ''))

  // Peak hours: inbound messages (in window) bucketed by hour-of-day (Taipei).
  const hourly = new Array(24).fill(0) as number[]
  for (const m of inbound) {
    if (m.timeMs == null || m.timeMs < startMs || m.timeMs > endMs) continue
    hourly[hourTaipei(m.timeMs)]++
  }

  // First-reply responsiveness: per conversation, the gap from the first inbound
  // (in window) to the first outbound after it. Median is reported (robust to the
  // odd conversation answered days later). Limited by MSG_LIMIT recent messages.
  const gaps: number[] = []
  let totalConvs = 0, repliedConvs = 0
  for (const c of fbRes.convs.concat(igRes.convs)) {
    const seq = (c.messages?.data ?? [])
      .map(m => ({ t: m.created_time ? new Date(m.created_time).getTime() : NaN, out: !!(m.from?.id && ownIds.has(m.from.id)) }))
      .filter(m => Number.isFinite(m.t))
      .sort((a, b) => a.t - b.t)
    const firstIn = seq.find(m => !m.out && m.t >= startMs && m.t <= endMs)
    if (!firstIn) continue
    totalConvs++
    const firstOut = seq.find(m => m.out && m.t > firstIn.t)
    if (firstOut) { repliedConvs++; gaps.push((firstOut.t - firstIn.t) / 60000) }
  }
  gaps.sort((a, b) => a - b)
  const firstReplyMedianMin = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null
  const replyRate = totalConvs > 0 ? repliedConvs / totalConvs : null

  return NextResponse.json({
    totals: {
      conversations: fbStat.conversations + igStat.conversations,
      inboundMessages: fbStat.inboundMessages + igStat.inboundMessages,
      uniqueSenders: allSenders.size,
    },
    byPlatform: { IG: igStat, FB: fbStat },
    daily: dailySeries,
    recent: recent.slice(0, 30),
    hourly,
    responsiveness: { firstReplyMedianMin, replyRate, repliedConvs, totalConvs },
    windowDays: nDays,
  })
}
