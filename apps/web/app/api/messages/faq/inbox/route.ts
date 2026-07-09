export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'

// List recent webhook-received messages + the agent's DRY-RUN would-be reply.
export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await can(uid, pageId, 'chatbot.manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
    .collection('inbox').get()
  const items = snap.docs.map(d => {
    const v = d.data()
    return {
      platform: v.platform, text: v.text, action: v.action, reply: v.reply,
      intent: v.intent, wouldSend: !!v.wouldSend, createdAt: String(v.createdAt ?? ''),
    }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
  return NextResponse.json({ items })
}
