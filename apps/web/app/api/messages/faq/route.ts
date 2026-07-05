export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { INTENTS, type IntentKey } from '@/lib/messages/intents'

// Phase 5-2a：AI agent 自動回覆「設定/知識庫」讀寫。此刀只存設定，尚未接 webhook/發送。
// 設計為 AI agent（非固定模板）：per-intent 答案 + 補充知識 + 語氣，都是 LLM 生成回覆時的
// grounding 來源。平台無關（Meta / 未來 LINE 共用同一份設定與 agent 核心）。

interface FaqAnswer { answer: string; enabled: boolean }
interface ScheduleEntry { date: string; label: string }   // date = YYYY-MM-DD
interface FaqConfig {
  enabled: boolean
  humanHandoffEnabled: boolean
  fallbackMessage: string
  answers: Partial<Record<IntentKey, FaqAnswer>>
  knowledgeBase: string   // 自由文字補充知識，agent 生成回覆時一併 grounding
  persona: string         // 語氣/角色設定（例：親切、專業、用「我們」自稱）
  // 例會排程：程式在 5-2b 用「今天之後最近的 date」算「下次例會」，時間/地點另存
  scheduleEntries: ScheduleEntry[]
  meetingTime: string     // 例：週四 19:30–21:30
  meetingLocation: string
  scheduleSheetUrl: string // 記住來源 Google Sheet 網址，方便重新同步
}

const DEFAULT_FALLBACK = '感謝您的訊息！我們會盡快由專人回覆您 🙏'
const DEFAULT_PERSONA = '親切、簡潔、有禮貌，用「我們」自稱，像分會小編。'
const emptyConfig = (): FaqConfig => ({ enabled: false, humanHandoffEnabled: true, fallbackMessage: DEFAULT_FALLBACK, answers: {}, knowledgeBase: '', persona: DEFAULT_PERSONA, scheduleEntries: [], meetingTime: '', meetingLocation: '', scheduleSheetUrl: '' })

// Only page admins (connected the page) or super-admins may read/write bot config.
async function assertAdmin(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return adminDoc.exists
}

async function authUid(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

export async function GET(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await assertAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config').get()
  const config = snap.exists ? { ...emptyConfig(), ...(snap.data() as Partial<FaqConfig>) } : emptyConfig()
  return NextResponse.json({ config, intents: INTENTS.filter(i => i.key !== 'other').map(i => ({ key: i.key, zh: i.zh, en: i.en })) })
}

export async function POST(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await assertAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const known = new Set(INTENTS.map(i => i.key))
  const inAnswers = (body.answers ?? {}) as Record<string, { answer?: unknown; enabled?: unknown }>
  const answers: Partial<Record<IntentKey, FaqAnswer>> = {}
  for (const [k, v] of Object.entries(inAnswers)) {
    if (!known.has(k as IntentKey)) continue
    answers[k as IntentKey] = { answer: String(v?.answer ?? '').slice(0, 1000), enabled: v?.enabled !== false }
  }
  const rawEntries = Array.isArray(body.scheduleEntries) ? body.scheduleEntries : []
  const scheduleEntries: ScheduleEntry[] = rawEntries
    .filter((e: { date?: unknown }) => typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e: { date: string; label?: unknown }) => ({ date: e.date, label: String(e.label ?? '').slice(0, 200) }))
    .slice(0, 200)

  const config: FaqConfig = {
    enabled: body.enabled === true,
    humanHandoffEnabled: body.humanHandoffEnabled !== false,
    fallbackMessage: String(body.fallbackMessage ?? DEFAULT_FALLBACK).slice(0, 1000),
    answers,
    knowledgeBase: String(body.knowledgeBase ?? '').slice(0, 4000),
    persona: String(body.persona ?? DEFAULT_PERSONA).slice(0, 500),
    scheduleEntries,
    meetingTime: String(body.meetingTime ?? '').slice(0, 200),
    meetingLocation: String(body.meetingLocation ?? '').slice(0, 300),
    scheduleSheetUrl: String(body.scheduleSheetUrl ?? '').slice(0, 500),
  }

  await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
    .set({ ...config, updatedAt: new Date().toISOString(), updatedBy: uid }, { merge: true })
  return NextResponse.json({ ok: true, config })
}
