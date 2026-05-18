export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

interface AiInsightDoc {
  question: string
  response?: { summary?: string }
  contextPage: string
  createdAt?: { toDate: () => Date }
}

interface Turn { question: string; summary: string }
interface Session { sessionId: string; date: string; contextPage: string; turns: Turn[] }

type ConvMsg = { role: string; content: string; timestamp: string }
type ConvDoc = {
  sessionId?: string
  pageContext?: string
  messages?: ConvMsg[]
  startedAt?: { toDate(): Date }
  _originalStart?: string
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')

  // Page-scoped: read from sidekickConversations
  if (pageId) {
    const adminSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
    if (!adminSnap.exists) {
      const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
      const viewerPages: { pageId: string; permissions?: { sidekick?: boolean } }[] = viewerSnap.data()?.pages ?? []
      if (!viewerPages.some(p => p.pageId === pageId && p.permissions?.sidekick)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const snap = await adminDb.collection('pages').doc(pageId).collection('sidekickConversations')
      .orderBy('startedAt', 'desc')
      .limit(50)
      .get()

    const sessions: Session[] = snap.docs
      .map(d => {
        const doc = d.data() as ConvDoc
        // migrated sessions store original time in _originalStart; fall back to startedAt
        const rawDt = doc._originalStart ? new Date(doc._originalStart) : (doc.startedAt?.toDate() ?? new Date())
        const msgs = doc.messages ?? []
        const turns: Turn[] = []
        for (let i = 0; i < msgs.length - 1; i++) {
          if (msgs[i].role === 'user' && msgs[i + 1]?.role === 'assistant') {
            turns.push({ question: msgs[i].content, summary: msgs[i + 1].content })
            i++
          }
        }
        // fallback: try any user message as question
        if (turns.length === 0) {
          const firstUser = msgs.find(m => m.role === 'user')
          if (!firstUser) return null
          turns.push({ question: firstUser.content, summary: '' })
        }
        return {
          sessionId: doc.sessionId ?? d.id,
          date: rawDt.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          contextPage: doc.pageContext ?? 'overview',
          turns,
        }
      })
      .filter((s): s is Session => s !== null)

    return NextResponse.json({ sessions })
  }

  // Fallback: read from legacy aiInsights
  const snap = await adminDb
    .collection('users').doc(uid)
    .collection('aiInsights')
    .orderBy('createdAt', 'desc')
    .limit(60)
    .get()

  const docs = snap.docs.map(d => ({
    id: d.id,
    ...(d.data() as AiInsightDoc),
    ts: (d.data() as AiInsightDoc).createdAt?.toDate() ?? new Date(0),
  }))

  const sessions: Session[] = []
  let current: typeof docs = []

  for (const doc of docs) {
    if (current.length === 0) {
      current.push(doc)
    } else {
      const gap = Math.abs(current[current.length - 1].ts.getTime() - doc.ts.getTime())
      if (gap <= 60 * 60 * 1000) {
        current.push(doc)
      } else {
        sessions.push(buildSession(current))
        current = [doc]
      }
    }
  }
  if (current.length > 0) sessions.push(buildSession(current))

  return NextResponse.json({ sessions })
}

function buildSession(docs: { id: string; question: string; response?: { summary?: string }; contextPage: string; ts: Date }[]): Session {
  const first = docs[0]
  return {
    sessionId: first.id,
    date: first.ts.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    contextPage: first.contextPage ?? 'overview',
    turns: docs.map(d => ({
      question: d.question ?? '',
      summary: d.response?.summary ?? '',
    })),
  }
}
