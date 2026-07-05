export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { geminiEmbed } from '@/lib/ai/geminiEmbed'

async function authUid(req: NextRequest): Promise<string | null> {
  const t = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!t) return null
  try { return (await adminAuth.verifyIdToken(t)).uid } catch { return null }
}
async function assertAdmin(uid: string, pageId: string): Promise<boolean> {
  return isSuperAdmin(uid)
    || (await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists
    || (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
}

// T2：回饋分析（👍/👎 統計 + 最常被倒讚意圖 + 近期倒讚案例）。
export async function GET(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await assertAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
    .collection('feedbackItems').limit(500).get()
  let up = 0, down = 0
  const byIntent: Record<string, { up: number; down: number }> = {}
  const downs: { message: string; reason: string; intent: string; createdAt: string }[] = []
  snap.forEach(d => {
    const v = d.data()
    const intent = String(v.intent ?? 'other')
    byIntent[intent] = byIntent[intent] ?? { up: 0, down: 0 }
    if (v.rating === 'up') { up++; byIntent[intent].up++ }
    else if (v.rating === 'down') {
      down++; byIntent[intent].down++
      downs.push({ message: String(v.message ?? ''), reason: String(v.reason ?? ''), intent, createdAt: String(v.createdAt ?? '') })
    }
  })
  downs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const topDownIntents = Object.entries(byIntent).map(([intent, c]) => ({ intent, ...c }))
    .filter(x => x.down > 0).sort((a, b) => b.down - a.down)
  return NextResponse.json({ up, down, total: up + down, topDownIntents, recentDown: downs.slice(0, 20) })
}

// Store 👍/👎 feedback on an AI agent reply → future improvement (few-shot / tuning).
// page-scoped, admin only. Stored under pages/{pageId}/faqBot/feedbackItems.
export async function POST(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  const rating: string = body.rating
  if (!pageId || (rating !== 'up' && rating !== 'down')) return NextResponse.json({ error: 'pageId and rating(up|down) required' }, { status: 400 })
  if (!(await assertAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const message = String(body.message ?? '').slice(0, 500)
  const reason = String(body.reason ?? '').slice(0, 1000)
  const configRef = adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')

  const ref = await configRef.collection('feedbackItems').add({
    message, reply: String(body.reply ?? '').slice(0, 2000),
    intent: String(body.intent ?? ''), model: String(body.model ?? ''),
    action: String(body.action ?? ''), rating, reason, source: 'preview',
    by: uid, createdAt: new Date().toISOString(),
  })

  // T3：存 question 的 embedding，供之後 few-shot 檢索（best-effort，失敗不影響回饋）。
  try {
    const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(uid, 'gemini'))
    if (geminiKey && message.trim()) await ref.update({ embedding: await geminiEmbed(message, geminiKey) })
  } catch { /* embedding is optional */ }

  // T1「更正即知識」：倒讚且有寫更正 → 直接進 corrections（agent 每次回覆一律參考）。
  let addedCorrection = false
  if (rating === 'down' && reason.trim()) {
    await configRef.set({
      corrections: FieldValue.arrayUnion({ text: reason.trim(), fromMessage: message, createdAt: new Date().toISOString(), by: uid }),
    }, { merge: true })
    addedCorrection = true
  }
  return NextResponse.json({ ok: true, addedCorrection })
}
