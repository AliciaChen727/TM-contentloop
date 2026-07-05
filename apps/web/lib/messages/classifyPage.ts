// Core of Phase 5-1 「常見問題分類」, shared by the on-demand route
// (/api/messages/classify) and the background cron (/api/cron/classify-messages).
// No auth here — callers must authorize + resolve the page owner + token first.
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getUserApiKey } from '@/lib/userApiKeys'
import { classifyMessages, CLASSIFIER_VERSION, type IntentKey } from '@/lib/messages/intents'

const BASE = 'https://graph.facebook.com/v21.0'
const DAY = 86400000
const TTL_DAYS = 180            // stored message text + summary auto-expire (privacy)
const MAX_CONV_PAGES = 5
const CONV_LIMIT = 50
const MSG_LIMIT = 100
const MAX_CLASSIFY = 300        // cap LLM work per run
export const FRESH_MS = 6 * 3600 * 1000 // cached summary is served if newer than this

export type RangeKey = '30d' | '90d' | 'all'
export interface IntentBucket { key: IntentKey; count: number; samples: string[] }
export interface ClassifyResult {
  intents: IntentBucket[]
  computedAt: number
  totalClassified: number
  newlyClassified: number
  cached: boolean
  windowDays: number
}

type RawMsg = { id?: string; created_time?: string; from?: { id?: string }; message?: string }
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

export async function classifyPageMessages(opts: {
  ownerUid: string
  pageId: string
  accessToken: string
  igUserId?: string
  range: RangeKey
  force?: boolean
}): Promise<ClassifyResult> {
  const { ownerUid, pageId, accessToken, igUserId, range, force } = opts
  const days = range === '90d' ? 90 : range === 'all' ? 3650 : 30
  const pageCol = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)
  const summaryRef = pageCol.collection('msgIntentSummary').doc(range)

  // Result-level cache: skip all Graph/LLM work when a fresh summary exists.
  if (!force) {
    const s = await summaryRef.get()
    const d = s.data()
    if (s.exists && d?.computedAt && (Date.now() - d.computedAt.toMillis()) < FRESH_MS) {
      return { intents: (d.intents ?? []) as IntentBucket[], computedAt: d.computedAt.toMillis(), totalClassified: d.totalClassified ?? 0, newlyClassified: 0, cached: true, windowDays: days }
    }
  }

  const ownIds = new Set<string>([pageId, ...(igUserId ? [igUserId] : [])])
  const startMs = Date.now() - days * DAY
  const [fb, ig] = await Promise.all([
    fetchConvsWithText(pageId, 'messenger', accessToken),
    fetchConvsWithText(pageId, 'instagram', accessToken),
  ])
  const byId = new Map<string, string>()
  for (const c of [...fb, ...ig]) {
    for (const m of c.messages?.data ?? []) {
      if (!m.id || !m.message) continue
      if (m.from?.id && ownIds.has(m.from.id)) continue // outbound
      if ((m.created_time ? new Date(m.created_time).getTime() : 0) < startMs) continue
      byId.set(m.id, m.message)
    }
  }
  const msgs = Array.from(byId.entries()).map(([id, text]) => ({ id, text }))

  const intentsCol = pageCol.collection('msgIntents')
  // Cached per-message classifications (only if produced by the current version).
  const cached = new Map<string, IntentKey>()
  for (let i = 0; i < msgs.length; i += 300) {
    const slice = msgs.slice(i, i + 300)
    const snaps = await adminDb.getAll(...slice.map(m => intentsCol.doc(m.id)))
    for (const s of snaps) {
      const dat = s.data()
      if (s.exists && (dat?.v ?? 1) === CLASSIFIER_VERSION) cached.set(s.id, (dat?.intent ?? 'other') as IntentKey)
    }
  }

  // Classify the uncached (capped), persist with TTL.
  const todo = msgs.filter(m => !cached.has(m.id)).slice(0, MAX_CLASSIFY)
  let newlyClassified = 0
  if (todo.length > 0) {
    const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(ownerUid, 'gemini'))
    if (geminiKey) {
      const results = await classifyMessages(todo.map(m => m.text), geminiKey)
      const now = Timestamp.now()
      const expireAt = Timestamp.fromMillis(Date.now() + TTL_DAYS * DAY)
      let batch = adminDb.batch(); let ops = 0
      for (let i = 0; i < todo.length; i++) {
        cached.set(todo[i].id, results[i])
        batch.set(intentsCol.doc(todo[i].id), { intent: results[i], v: CLASSIFIER_VERSION, text: todo[i].text.slice(0, 500), classifiedAt: now, expireAt }, { merge: true })
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0 }
      }
      if (ops > 0) await batch.commit()
      newlyClassified = todo.length
    }
  }

  // Aggregate counts + example texts per intent.
  const counts = new Map<IntentKey, number>()
  const samples = new Map<IntentKey, string[]>()
  for (const m of msgs) {
    const intent = cached.get(m.id) ?? 'other'
    counts.set(intent, (counts.get(intent) ?? 0) + 1)
    const arr = samples.get(intent) ?? []
    if (arr.length < 6) { arr.push(m.text.replace(/\s+/g, ' ').slice(0, 120)); samples.set(intent, arr) }
  }
  const intents: IntentBucket[] = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, samples: samples.get(key) ?? [] }))
    .sort((a, b) => b.count - a.count)

  const computedAt = Timestamp.now()
  await summaryRef.set({
    intents, computedAt, totalClassified: msgs.length,
    expireAt: Timestamp.fromMillis(Date.now() + TTL_DAYS * DAY),
  }, { merge: true })

  return { intents, computedAt: computedAt.toMillis(), totalClassified: msgs.length, newlyClassified, cached: false, windowDays: days }
}
