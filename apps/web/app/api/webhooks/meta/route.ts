export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { generateReply, type AgentConfig } from '@/lib/messages/replyAgent'
import { getFewShot } from '@/lib/messages/feedbackFewShot'

// Phase 5-2b-2：Meta（Messenger + Instagram）私訊 webhook。
// ⚠️ DRY-RUN：只跑 agent、把「會怎麼回」記進 inbox，**不真的發送**（發送在 5-2c）。
// 單一 URL 供 FB Messenger 與 IG 共用；payload.object 區分（'page' vs 'instagram'）。

// GET：Meta 設定 webhook 時的驗證握手，回 hub.challenge。
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const mode = p.get('hub.mode'), token = p.get('hub.verify_token'), challenge = p.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

function verifySignature(raw: string, sigHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !sigHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader)) } catch { return false }
}

// IG webhook entry.id = IG business account id (igUserId). Map it → our pageId.
async function resolvePageIdFromIg(igUserId: string): Promise<string | null> {
  try {
    const snap = await adminDb.collectionGroup('metaTokens').where('igUserId', '==', igUserId).limit(1).get()
    return snap.empty ? null : snap.docs[0].id
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Bad signature', { status: 401 })
  }
  let body: { object?: string; entry?: { id?: string; messaging?: unknown[] }[] }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  const platform: 'IG' | 'FB' = body.object === 'instagram' ? 'IG' : 'FB'
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null
  const geminiKey = process.env.GEMINI_API_KEY ?? null

  for (const entry of body.entry ?? []) {
    const entryId = String(entry.id ?? '')
    if (!entryId) continue
    const pageId = platform === 'IG' ? await resolvePageIdFromIg(entryId) : entryId
    if (!pageId) continue

    const cfgSnap = await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config').get()
    if (!cfgSnap.exists) continue
    const config = cfgSnap.data() as AgentConfig

    for (const evRaw of entry.messaging ?? []) {
      const ev = evRaw as { sender?: { id?: string }; message?: { text?: string; is_echo?: boolean } }
      const text = ev.message?.text
      const senderId = ev.sender?.id
      if (!text || !senderId || ev.message?.is_echo) continue // skip our own echoes / non-text

      const fewShot = await getFewShot(pageId, text, geminiKey).catch(() => [])
      const result = await generateReply({ message: text, config, todayIso, anthropicKey, geminiKey, fewShot })
      const wouldSend = config.enabled === true && result.action === 'reply'

      // DRY-RUN: record what the agent WOULD do; never send in 5-2b-2.
      await adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
        .collection('inbox').add({
          platform, senderId, text: text.slice(0, 500),
          action: result.action, reply: result.text, intent: result.intent, model: result.model ?? '',
          wouldSend, sent: false, dryRun: true,
          createdAt: new Date().toISOString(),
        })
      // 5-2c 會在此處：if (wouldSend) → Send API 發送。
    }
  }
  return NextResponse.json({ ok: true })
}
