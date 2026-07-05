export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { generateReply, type AgentConfig } from '@/lib/messages/replyAgent'
import { getFewShot } from '@/lib/messages/feedbackFewShot'

// Dry-run preview: run the AI agent on a sample message and return what it WOULD
// reply. No webhook, no sending — for the owner to tune answers/knowledge.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const body = await req.json().catch(() => ({}))
  const pageId: string | undefined = body.pageId
  const message: string = String(body.message ?? '').slice(0, 500)
  if (!pageId || !message.trim()) return NextResponse.json({ error: 'pageId and message required' }, { status: 400 })

  // admin only
  const isAdmin = isSuperAdmin(uid)
    || (await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists
    || (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config').get()
  if (!snap.exists) return NextResponse.json({ error: '尚未設定 FAQ' }, { status: 400 })
  const config = snap.data() as AgentConfig

  const anthropicKey = (await getUserApiKey(uid, 'anthropic')) ?? process.env.ANTHROPIC_API_KEY ?? null
  const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(uid, 'gemini')) ?? null
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

  const fewShot = await getFewShot(pageId, message, geminiKey).catch(() => [])
  const result = await generateReply({ message, config, todayIso, anthropicKey, geminiKey, fewShot })
  return NextResponse.json(result)
}
