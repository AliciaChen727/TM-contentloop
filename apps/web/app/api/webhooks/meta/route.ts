export const dynamic = 'force-dynamic'
export const maxDuration = 120   // waitUntil 尾巴仍受函式時限約束（兩次 LLM 呼叫要留餘裕）
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { waitUntil } from '@vercel/functions'
import { adminDb } from '@/lib/firebase/admin'
import { generateReply, type AgentConfig } from '@/lib/messages/replyAgent'
import { getFewShot } from '@/lib/messages/feedbackFewShot'

// Phase 5-2b-2：Meta（Messenger + Instagram）私訊 webhook。
// ⚠️ DRY-RUN：只跑 agent、把「會怎麼回」記進 inbox，**不真的發送**（發送在 5-2c）。
// 單一 URL 供 FB Messenger 與 IG 共用；payload.object 區分（'page' vs 'instagram'）。
//
// 5-2c-0 runtime 重構：Meta 等不到快速 200 就會重送 webhook。因此 POST 只做
// 「驗簽 + 寫去重帳本 + 回 200」，agent 生成與寫 inbox 一律丟進 waitUntil 的尾巴跑。
// 去重用 Meta 的 message id（mid）當 doc id，配合 processing/done/failed 狀態機（見 claimEvent）：
// 重送幾次都只處理一次，但尾巴失敗時 Meta 的重送仍救得回來，不會靜默掉訊息。

const EVENT_TTL_DAYS = 30
const LEASE_MS = 3 * 60_000   // processing 租約：逾時視為死掉的 invocation，可被重新認領

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

// Vercel 上把工作接到 response 之後跑，讓 Meta 秒收 200。
// ⚠️ 本機 `next dev` 沒有 Vercel 執行環境，實測 waitUntil()**不會 throw、只是不保證存活**
// （尾巴能跑純粹靠 dev process 沒結束）→ 不能用 try/catch 偵測。改以 VERCEL env 明確分流：
// 本機直接 await，行為可觀察、可測；正式站才走 waitUntil。
function runAfterResponse(work: Promise<void>): Promise<void> | void {
  if (process.env.VERCEL) {
    waitUntil(work)
    return
  }
  return work
}

type InboundEvent = {
  mid: string
  platform: 'IG' | 'FB'
  entryId: string
  senderId: string
  text: string
}

// 同步段：認領這則 mid。
//
// ⚠️ 不能只用 create() 當「處理過」的旗標：我們是先回 200 再做事，若尾巴失敗
// （Anthropic 529、Firestore 抖動、invocation 被砍），Meta 重送時 create() 會撞已存在
// → 整則被永久丟棄，而且沒有任何人會發現。故帳本是**狀態機**不是布林旗標：
//   done                    → 確定跳過
//   processing 且租約未過期  → 另一個 invocation 正在處理，跳過
//   failed / 租約逾期        → 重新認領，讓 Meta 的重送真的能救回來
// 兩個並發重送必須靠 transaction 才分得出勝負，create() 表達不了這件事。
//
// 🔒 此 collection 是 top-level（拿到 mid 時還沒解析出 pageId），因此**只存識別欄位、
// 不存訊息內容，也不存 senderId**——原文只在記憶體傳給尾巴，最後寫進 page-scoped 的 inbox。
async function claimEvent(ev: InboundEvent): Promise<boolean> {
  const ref = adminDb.collection('metaWebhookEvents').doc(ev.mid)
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const prev = snap.data()
      if (prev) {
        if (prev.status === 'done') return false
        const startedAt = Date.parse(String(prev.startedAt ?? '')) || 0
        if (prev.status === 'processing' && Date.now() - startedAt < LEASE_MS) return false
      }
      tx.set(ref, {
        platform: ev.platform, entryId: ev.entryId,
        status: 'processing', startedAt: new Date().toISOString(),
        attempts: Number(prev?.attempts ?? 0) + 1,
        expireAt: new Date(Date.now() + EVENT_TTL_DAYS * 86400_000),
      })
      return true
    })
  } catch (e) {
    console.error('[meta-webhook] claimEvent failed', { mid: ev.mid }, e)
    return false
  }
}

// 尾巴結束後回填狀態。若這一步自己失敗，doc 會留在 processing → 租約到期後可被重新認領。
async function markEvent(mid: string, status: 'done' | 'failed', error?: unknown): Promise<void> {
  try {
    await adminDb.collection('metaWebhookEvents').doc(mid).set({
      status, finishedAt: new Date().toISOString(),
      ...(error ? { error: String(error).slice(0, 300) } : {}),
    }, { merge: true })
  } catch (e) {
    console.error('[meta-webhook] markEvent failed', { mid, status }, e)
  }
}

// 非同步段（response 之後）：解析 pageId → 讀 config → 跑 agent → 寫 inbox。
async function processEvent(ev: InboundEvent): Promise<void> {
  const pageId = ev.platform === 'IG' ? await resolvePageIdFromIg(ev.entryId) : ev.entryId
  if (!pageId) return

  const cfgRef = adminDb.collection('pages').doc(pageId).collection('faqBot').doc('config')
  const cfgSnap = await cfgRef.get()
  if (!cfgSnap.exists) return
  const config = cfgSnap.data() as AgentConfig

  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null
  const geminiKey = process.env.GEMINI_API_KEY ?? null

  const fewShot = await getFewShot(pageId, ev.text, geminiKey).catch(() => [])
  const result = await generateReply({ message: ev.text, config, todayIso, anthropicKey, geminiKey, fewShot })
  const wouldSend = config.enabled === true && result.action === 'reply'

  // DRY-RUN: record what the agent WOULD do; never send in 5-2b-2.
  // doc id = mid（原本是 add() 隨機 id）→ 即使去重帳本失守也不會寫出兩筆。
  await cfgRef.collection('inbox').doc(ev.mid).set({
    platform: ev.platform, senderId: ev.senderId, text: ev.text.slice(0, 500),
    action: result.action, reply: result.text, intent: result.intent, model: result.model ?? '',
    wouldSend, sent: false, dryRun: true,
    createdAt: new Date().toISOString(),
  })
  // 5-2c 會在此處：if (wouldSend) → Send API 發送。
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Bad signature', { status: 401 })
  }
  let body: { object?: string; entry?: { id?: string; messaging?: unknown[] }[] }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  const platform: 'IG' | 'FB' = body.object === 'instagram' ? 'IG' : 'FB'

  // 同步段：只做便宜的事（解析 + 每則一次 Firestore create），確保秒回 200。
  const claimed: InboundEvent[] = []
  for (const entry of body.entry ?? []) {
    const entryId = String(entry.id ?? '')
    if (!entryId) continue

    for (const evRaw of entry.messaging ?? []) {
      const m = evRaw as { sender?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean } }
      const text = m.message?.text
      const senderId = m.sender?.id
      const mid = m.message?.mid
      // skip our own echoes / non-text / 沒有 mid 就無從去重
      if (!text || !senderId || !mid || m.message?.is_echo) continue

      const ev: InboundEvent = { mid, platform, entryId, senderId, text }
      if (await claimEvent(ev)) claimed.push(ev)
    }
  }

  // 非同步段：agent 生成與寫入接在 response 之後，絕不讓 Meta 等 LLM。
  const tail = (async () => {
    for (const ev of claimed) {
      try {
        await processEvent(ev)
        await markEvent(ev.mid, 'done')
      } catch (e) {
        console.error('[meta-webhook] processEvent failed', { mid: ev.mid, platform: ev.platform }, e)
        await markEvent(ev.mid, 'failed', e)
      }
    }
  })()

  const pending = runAfterResponse(tail)
  if (pending) await pending   // 本機 dev fallback：沒有 waitUntil 就同步等完

  return NextResponse.json({ ok: true })
}
