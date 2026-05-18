export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

interface AiInsightDoc {
  question?: string
  response?: { summary?: string; bullets?: string[]; actions?: string[] }
  contextPage?: string
  createdAt?: { toDate(): Date }
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const { pageId } = await req.json() as { pageId?: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // owner only
  const adminSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (!adminSnap.exists) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // read all aiInsights ascending so session grouping is correct
  const snap = await adminDb.collection('users').doc(uid).collection('aiInsights')
    .orderBy('createdAt', 'asc')
    .get()

  const docs = snap.docs
    .map(d => ({ id: d.id, ...(d.data() as AiInsightDoc), ts: (d.data() as AiInsightDoc).createdAt?.toDate() ?? new Date(0) }))
    .filter(d => d.question)

  // group into sessions by 60-min window
  const groups: typeof docs[] = []
  let current: typeof docs = []
  for (const doc of docs) {
    if (current.length === 0) {
      current.push(doc)
    } else {
      const gap = doc.ts.getTime() - current[current.length - 1].ts.getTime()
      if (gap <= 60 * 60 * 1000) {
        current.push(doc)
      } else {
        groups.push(current)
        current = [doc]
      }
    }
  }
  if (current.length > 0) groups.push(current)

  const convRef = adminDb.collection('pages').doc(pageId).collection('sidekickConversations')
  let migrated = 0

  for (const group of groups) {
    const first = group[0]
    // deterministic sessionId so re-runs are idempotent
    const sessionId = `migrate_${first.ts.getTime()}`
    const existing = await convRef.doc(sessionId).get()
    if (existing.exists) continue

    const messages: { role: 'user' | 'assistant'; content: string; timestamp: string }[] = []
    for (const doc of group) {
      messages.push({ role: 'user', content: doc.question ?? '', timestamp: doc.ts.toISOString() })
      const r = doc.response
      const assistantContent = [r?.summary, ...(r?.bullets ?? []), ...(r?.actions ?? [])].filter(Boolean).join('\n').slice(0, 1000)
      messages.push({ role: 'assistant', content: assistantContent, timestamp: doc.ts.toISOString() })
    }

    const last = group[group.length - 1]
    await convRef.doc(sessionId).set({
      sessionId,
      userId: uid,
      pageContext: first.contextPage ?? 'overview',
      messages,
      feedback: null,
      improveReason: null,
      totalTurns: group.length,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: FieldValue.serverTimestamp(),
      _migratedFrom: 'aiInsights',
      _originalStart: first.ts.toISOString(),
      _originalEnd: last.ts.toISOString(),
    })
    migrated++
  }

  return NextResponse.json({ ok: true, migrated, total: groups.length })
}
