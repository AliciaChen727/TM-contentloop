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

  // Group docs within 60-minute windows into sessions
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
