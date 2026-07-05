export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { classifyMessages, intentLabel, CLASSIFIER_VERSION, type IntentKey } from '@/lib/messages/intents'

const BASE = 'https://graph.facebook.com/v21.0'
const DAY = 86400000
const TTL_DAYS = 180            // stored message text auto-expires (privacy)
const MAX_CONV_PAGES = 5
const CONV_LIMIT = 50
const MSG_LIMIT = 100
const MAX_CLASSIFY = 300        // cap LLM work per run
const FRESH_MS = 6 * 3600 * 1000 // serve the cached Top-questions summary if newer than this

type RawFrom = { id?: string }
type RawMsg = { id?: string; created_time?: string; from?: RawFrom; message?: string }
type RawConv = { messages?: { data?: RawMsg[] } }

async function fetchConvsWithText(pageId: string, platform: 'messenger' | 'instagram', token: string): Promise<RawConv[]> {
  const convs: RawConv[] = []
  const first = new URL(`${BASE}/${pageId}/conversations`)
  first.searchParams.set('platform', platform)
  first.searchParams.set('fields', `messages.limit(${MSG_LIMIT}){id,created_time,from,message}`)
  first.searchParams.set('limit', String(CONV_LIMIT))
  first.searchParams.set('access_token', token)
  let next: string | null = first.toString()
  let page = 0
  while (next && page < MAX_CONV_PAGES) {
    try {
      const r: Response = await fetch(next)
      const d = await r.json()
      if (!r.ok || d.error) break
      convs.push(...((d.data ?? []) as RawConv[]))
      next = d.paging?.next ?? null
      page++
    } catch { break }
  }
  return convs
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const days: number = body.range === '90d' ? 90 : body.range === 'all' ? 3650 : 30

  // pageId isolation (same as /api/messages).
  let ownerUid = uid
  const ownTokenSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (!ownTokenSnap.exists) {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const viewerPages: { pageId: string }[] = viewerSnap.data()?.pages ?? []
    if (!(viewerPages.some(p => p.pageId === pageId) || isSuperAdmin(uid))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const owner = await resolvePageOwnerUid(pageId)
    if (!owner) return NextResponse.json({ error: 'Page owner not found' }, { status: 404 })
    ownerUid = owner
  }
  const tokenSnap = ownerUid === uid ? ownTokenSnap
    : await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
  const tokenData = tokenSnap.data() as { accessToken?: string; igUserId?: string } | undefined
  const accessToken = tokenData?.accessToken
  if (!accessToken) return NextResponse.json({ error: 'No page access token' }, { status: 400 })
  const ownIds = new Set<string>([pageId, ...(tokenData?.igUserId ? [tokenData.igUserId] : [])])

  const en = body.lang === 'en'
  const force: boolean = body.force === true
  const rangeKey = body.range === '90d' ? '90d' : body.range === 'all' ? 'all' : '30d'
  const pageCol = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)
  const summaryRef = pageCol.collection('msgIntentSummary').doc(rangeKey)
  const withLabels = (arr: { key: IntentKey; count: number; samples: string[] }[]) =>
    arr.map(i => ({ key: i.key, label: intentLabel(i.key, en), count: i.count, samples: i.samples ?? [] }))

  // RESULT-LEVEL CACHE: serve the last computed Top-questions summary without any
  // Graph fetch or LLM call, unless it's stale (>FRESH_MS) or the caller forces a
  // refresh. Per-message classifications are also cached (by msgId) below, so even
  // a forced recompute only classifies genuinely new messages.
  if (!force) {
    const s = await summaryRef.get()
    const d = s.data()
    if (s.exists && d?.computedAt && (Date.now() - d.computedAt.toMillis()) < FRESH_MS) {
      return NextResponse.json({ topIntents: withLabels(d.intents ?? []), cached: true, computedAt: d.computedAt.toMillis(), windowDays: days })
    }
  }

  // Collect inbound messages (with text) in the window.
  const startMs = Date.now() - days * DAY
  const [fb, ig] = await Promise.all([
    fetchConvsWithText(pageId, 'messenger', accessToken),
    fetchConvsWithText(pageId, 'instagram', accessToken),
  ])
  const inbound: { id: string; text: string }[] = []
  for (const c of [...fb, ...ig]) {
    for (const m of c.messages?.data ?? []) {
      if (!m.id || !m.message) continue
      if (m.from?.id && ownIds.has(m.from.id)) continue // outbound
      const t = m.created_time ? new Date(m.created_time).getTime() : 0
      if (t < startMs) continue
      inbound.push({ id: m.id, text: m.message })
    }
  }
  // dedupe by message id
  const byId = new Map(inbound.map(m => [m.id, m]))
  const msgs = Array.from(byId.values())

  const intentsCol = pageCol.collection('msgIntents')

  // Read cached classifications (skip re-classifying) — but only if they were
  // produced by the current taxonomy version; stale ones get re-classified.
  const cached = new Map<string, IntentKey>()
  for (let i = 0; i < msgs.length; i += 300) {
    const slice = msgs.slice(i, i + 300)
    const snaps = await adminDb.getAll(...slice.map(m => intentsCol.doc(m.id)))
    for (const s of snaps) {
      const dat = s.data()
      if (s.exists && (dat?.v ?? 1) === CLASSIFIER_VERSION) cached.set(s.id, (dat?.intent ?? 'other') as IntentKey)
    }
  }

  // Classify the uncached (capped), then persist with TTL.
  const todo = msgs.filter(m => !cached.has(m.id)).slice(0, MAX_CLASSIFY)
  let classified = 0
  if (todo.length > 0) {
    const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(ownerUid, 'gemini'))
    if (geminiKey) {
      const results = await classifyMessages(todo.map(m => m.text), geminiKey)
      const now = Timestamp.now()
      const expireAt = Timestamp.fromMillis(Date.now() + TTL_DAYS * DAY)
      let batch = adminDb.batch(); let ops = 0
      for (let i = 0; i < todo.length; i++) {
        const intent = results[i]
        cached.set(todo[i].id, intent)
        batch.set(intentsCol.doc(todo[i].id), { intent, v: CLASSIFIER_VERSION, text: todo[i].text.slice(0, 500), classifiedAt: now, expireAt }, { merge: true })
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0 }
      }
      if (ops > 0) await batch.commit()
      classified = todo.length
    }
  }

  // Aggregate intent counts + a few example texts per intent (for the owner's
  // drill-down). Text is only ever returned to an authorized admin of THIS page.
  const counts = new Map<IntentKey, number>()
  const samples = new Map<IntentKey, string[]>()
  for (const m of msgs) {
    const intent = cached.get(m.id) ?? 'other'
    counts.set(intent, (counts.get(intent) ?? 0) + 1)
    const arr = samples.get(intent) ?? []
    if (arr.length < 6) { arr.push(m.text.replace(/\s+/g, ' ').slice(0, 120)); samples.set(intent, arr) }
  }
  const intentsArr = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, samples: samples.get(key) ?? [] }))
    .sort((a, b) => b.count - a.count)

  // Persist the computed summary so the next open serves it from cache.
  const computedAt = Timestamp.now()
  await summaryRef.set({
    intents: intentsArr, computedAt, totalClassified: msgs.length,
    expireAt: Timestamp.fromMillis(Date.now() + TTL_DAYS * DAY),
  }, { merge: true })

  return NextResponse.json({
    topIntents: withLabels(intentsArr), cached: false, computedAt: computedAt.toMillis(),
    totalClassified: msgs.length, newlyClassified: classified, windowDays: days,
  })
}
