export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeFeedback, type HumanAction } from '@/lib/sidekick/feedbackStore'
import { getUserApiKey } from '@/lib/userApiKeys'
import { geminiEmbed } from '@/lib/ai/geminiEmbed'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { rating, response, pageContext, dataSnapshot, improveReason, improveNote, pageId, humanAction, adoptedText, goal } = await req.json() as {
    rating: 'helpful' | 'improve'
    response: string
    pageContext: string
    dataSnapshot?: object | null
    improveReason?: string
    improveNote?: string
    pageId?: string
    humanAction?: HumanAction
    adoptedText?: string
    goal?: string
  }

  if (!rating || !response) return NextResponse.json({ error: 'rating and response required' }, { status: 400 })

  // Legacy per-user write — kept for backward-compat with the existing retrieval
  // path (Sidekick prompt's helpful/improve). Slice 10 switches retrieval to the
  // page-level store below.
  const record: Record<string, unknown> = {
    rating,
    response: response.slice(0, 2000),
    pageContext: pageContext ?? '',
    dataSnapshot: dataSnapshot ?? null,
    createdAt: FieldValue.serverTimestamp(),
  }
  if (improveReason) record.improveReason = improveReason
  if (improveNote?.trim()) record.improveNote = improveNote.trim()
  await adminDb.collection('users').doc(uid).collection('sidekickFeedback').add(record)

  // New page-level memory (shared across the page's admins). thumbs-up ≈ adopted,
  // thumbs-down ≈ rejected, unless an explicit humanAction is provided.
  if (pageId) {
    const ctx = typeof dataSnapshot === 'object' && dataSnapshot ? JSON.stringify(dataSnapshot).slice(0, 2000) : ''
    // Embed (context + reply) for semantic retrieval. Best-effort — skip on failure.
    let embedding: number[] | null = null
    try {
      const geminiKey = process.env.GEMINI_API_KEY ?? (await getUserApiKey(uid, 'gemini'))
      if (geminiKey) embedding = await geminiEmbed(`${pageContext ?? ''}\n${response}`, geminiKey)
    } catch { /* no embedding → retrieval falls back to metadata */ }

    await writeFeedback(pageId, {
      source: 'sidekick',
      goal: goal ?? null,
      alertType: pageContext ?? null,
      context: ctx,
      output: response,
      humanAction: humanAction ?? (rating === 'helpful' ? 'adopted' : 'rejected'),
      adoptedText: adoptedText ?? null,
      byUid: uid,
      embedding,
    })
  }

  return NextResponse.json({ ok: true })
}
