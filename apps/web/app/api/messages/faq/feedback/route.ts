export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

// Store 👍/👎 feedback on an AI agent reply → future improvement (few-shot / tuning).
// page-scoped, admin only. Stored under pages/{pageId}/faqBot/feedbackItems.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  const rating: string = body.rating
  if (!pageId || (rating !== 'up' && rating !== 'down')) return NextResponse.json({ error: 'pageId and rating(up|down) required' }, { status: 400 })

  const isAdmin = isSuperAdmin(uid)
    || (await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists
    || (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const message = String(body.message ?? '').slice(0, 500)
  const reason = String(body.reason ?? '').slice(0, 1000)
  const configRef = adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')

  await configRef.collection('feedbackItems').add({
    message, reply: String(body.reply ?? '').slice(0, 2000),
    intent: String(body.intent ?? ''), model: String(body.model ?? ''),
    action: String(body.action ?? ''), rating, reason, source: 'preview',
    by: uid, createdAt: new Date().toISOString(),
  })

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
