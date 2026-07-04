export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'

const BASE = 'https://graph.facebook.com/v21.0'
const DAYS = 30                 // daily buckets window
const MAX_CONV_PAGES = 5        // pagination safety cap
const CONV_LIMIT = 50           // conversations per page
const MSG_LIMIT = 25            // recent messages expanded per conversation

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
interface DailyPoint { date: string; ig: number; fb: number }

function dateKeyTaipei(iso: string): string {
  // Bucket by the user's local day (TM chapter is in Taiwan).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
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

// Reduce one platform's conversations into stats + daily buckets + recent list.
// ownIds = the page's own participant ids (so we can tell inbound from outbound).
function reduceConversations(
  convs: RawConv[], platform: 'IG' | 'FB', ownIds: Set<string>,
  daily: Map<string, DailyPoint>, recent: RecentItem[],
): { inbound: number; senders: Set<string> } {
  const senders = new Set<string>()
  let inbound = 0
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
      const fromId = m.from?.id
      if (fromId && ownIds.has(fromId)) continue // outbound (our own reply)
      inbound++
      if (fromId) senders.add(fromId)
      if (m.created_time) {
        const key = dateKeyTaipei(m.created_time)
        const pt = daily.get(key) ?? { date: key, ig: 0, fb: 0 }
        if (platform === 'IG') pt.ig++; else pt.fb++
        daily.set(key, pt)
      }
    }
  }
  return { inbound, senders }
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
  const daily = new Map<string, DailyPoint>()
  const recent: RecentItem[] = []

  const [fbRes, igRes] = await Promise.all([
    fetchConversations(pageId, 'messenger', accessToken),
    fetchConversations(pageId, 'instagram', accessToken),
  ])

  const fbReduced = reduceConversations(fbRes.convs, 'FB', ownIds, daily, recent)
  const igReduced = reduceConversations(igRes.convs, 'IG', ownIds, daily, recent)

  const fbStat: PlatformStat = {
    available: !fbRes.error, error: fbRes.error,
    conversations: fbRes.convs.length, inboundMessages: fbReduced.inbound, uniqueSenders: fbReduced.senders.size,
  }
  const igStat: PlatformStat = {
    available: !igRes.error, error: igRes.error,
    conversations: igRes.convs.length, inboundMessages: igReduced.inbound, uniqueSenders: igReduced.senders.size,
  }

  // Last DAYS days, oldest→newest, zero-filled.
  const dailySeries: DailyPoint[] = []
  const today = new Date()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = dateKeyTaipei(d.toISOString())
    dailySeries.push(daily.get(key) ?? { date: key, ig: 0, fb: 0 })
  }

  const allSenders = new Set<string>(Array.from(fbReduced.senders).concat(Array.from(igReduced.senders)))
  recent.sort((a, b) => (b.lastTime ?? '').localeCompare(a.lastTime ?? ''))

  return NextResponse.json({
    totals: {
      conversations: fbStat.conversations + igStat.conversations,
      inboundMessages: fbStat.inboundMessages + igStat.inboundMessages,
      uniqueSenders: allSenders.size,
    },
    byPlatform: { IG: igStat, FB: fbStat },
    daily: dailySeries,
    recent: recent.slice(0, 30),
    windowDays: DAYS,
  })
}
