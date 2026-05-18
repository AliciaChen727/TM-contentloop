export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

async function getConvRef(uid: string, pageId: string | undefined, sessionId: string) {
  if (pageId) return adminDb.collection('pages').doc(pageId).collection('sidekickConversations').doc(sessionId)
  return adminDb.collection('users').doc(uid).collection('sidekickConversations').doc(sessionId)
}

async function hasPageAccess(uid: string, pageId: string): Promise<boolean> {
  const adminSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (adminSnap.exists) return true
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const viewerPages: { pageId: string; permissions?: { sidekick?: boolean } }[] = viewerSnap.data()?.pages ?? []
  return viewerPages.some(p => p.pageId === pageId && p.permissions?.sidekick)
}

// POST: upsert or close conversation
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const { action, sessionId, pageId, pageContext, dataSnapshot, newMessages, feedback, improveReason, totalTurns, isFirst } = await req.json() as {
    action: 'upsert' | 'close'
    sessionId: string
    pageId?: string
    pageContext?: string
    dataSnapshot?: { dateRange?: string; avgCTR?: number; avgCPA?: number; totalAds?: number } | null
    newMessages?: { role: 'user' | 'assistant'; content: string; timestamp: string }[]
    feedback?: 'helpful' | 'improve' | null
    improveReason?: string | null
    totalTurns?: number
    isFirst?: boolean
  }

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (pageId && !(await hasPageAccess(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = await getConvRef(uid, pageId, sessionId)
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (isFirst) {
    update.sessionId = sessionId
    update.userId = uid
    update.pageContext = pageContext ?? ''
    update.feedback = null
    update.improveReason = null
    update.startedAt = FieldValue.serverTimestamp()
    if (dataSnapshot) update.dataSnapshot = dataSnapshot
  }
  if (newMessages?.length) update.messages = FieldValue.arrayUnion(...newMessages)
  if (totalTurns !== undefined) update.totalTurns = totalTurns
  if (feedback !== undefined) update.feedback = feedback
  if (improveReason !== undefined) update.improveReason = improveReason
  if (action === 'close') update.endedAt = FieldValue.serverTimestamp()

  await ref.set(update, { merge: true })
  return NextResponse.json({ ok: true })
}

// GET: owner-only CSV export
export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  const startDate = req.nextUrl.searchParams.get('startDate')
  const endDate = req.nextUrl.searchParams.get('endDate')
  const feedbackFilter = req.nextUrl.searchParams.get('feedbackFilter') ?? 'all'

  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // owner check
  const adminSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (!adminSnap.exists) return NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 })

  // get page name for filename
  const pageSnap = await adminDb.collection('pages').doc(pageId).get()
  const pageName = (pageSnap.data()?.name ?? pageId).replace(/[^\w一-鿿]/g, '_')

  let query = adminDb.collection('pages').doc(pageId).collection('sidekickConversations')
    .orderBy('startedAt', 'asc') as FirebaseFirestore.Query

  if (startDate) query = query.where('startedAt', '>=', new Date(startDate))
  if (endDate) {
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)
    query = query.where('startedAt', '<=', end)
  }

  const snap = await query.limit(500).get()

  type ConvDoc = {
    sessionId?: string; pageContext?: string; feedback?: string | null; improveReason?: string | null
    dataSnapshot?: { avgCTR?: number; avgCPA?: number; totalAds?: number }
    messages?: { role: string; content: string; timestamp: string }[]
    startedAt?: { toDate(): Date }
  }

  let docs = snap.docs.map(d => d.data() as ConvDoc)
  if (feedbackFilter === 'has_feedback') docs = docs.filter(d => d.feedback != null)
  if (feedbackFilter === 'improve_only') docs = docs.filter(d => d.feedback === 'improve')

  const header = 'sessionId,日期,時間,頁面,角色,對話內容,用戶評分,改進原因,當下CTR,當下CPA,當下素材數\n'
  const escapeCell = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows: string[] = []
  for (const doc of docs) {
    const startDt = doc.startedAt?.toDate() ?? new Date()
    const ctr = doc.dataSnapshot?.avgCTR?.toFixed(2) ?? ''
    const cpa = doc.dataSnapshot?.avgCPA?.toFixed(0) ?? ''
    const totalAds = doc.dataSnapshot?.totalAds ?? ''
    const feedbackLabel = doc.feedback === 'helpful' ? '有幫助' : doc.feedback === 'improve' ? '改進' : ''

    for (const msg of doc.messages ?? []) {
      const msgDt = msg.timestamp ? new Date(msg.timestamp) : startDt
      rows.push([
        escapeCell(doc.sessionId),
        escapeCell(msgDt.toLocaleDateString('zh-TW')),
        escapeCell(msgDt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })),
        escapeCell(doc.pageContext),
        escapeCell(msg.role === 'user' ? '用戶' : 'AI'),
        escapeCell(msg.content),
        escapeCell(feedbackLabel),
        escapeCell(doc.improveReason ?? ''),
        escapeCell(ctr),
        escapeCell(cpa),
        escapeCell(String(totalAds)),
      ].join(','))
    }
  }

  const startLabel = startDate ? startDate.slice(0, 10).replace(/-/g, '') : '全部'
  const endLabel = endDate ? endDate.slice(0, 10).replace(/-/g, '') : '今天'
  const filename = `${pageName}_sidekick_對話紀錄_${startLabel}_${endLabel}.csv`

  return new NextResponse('﻿' + header + rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
