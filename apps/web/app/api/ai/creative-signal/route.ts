/**
 * Creative intent signal (Phase 1 — capture). When a user takes an AI-generated
 * image into Canva ("一鍵匯入 Canva") or downloads it, record the generating
 * prompt as a soft positive into feedback memory (source:'creative'), so future
 * image-prompt generation can few-shot from prompts users actually used.
 *
 * Weaker than 'adopted' (import ≠ posted): weighted by signalWeight. A later
 * "actually posted" detection can upgrade it (Phase 2). BFF: Bearer + page access.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { writeFeedback } from '@/lib/sidekick/feedbackStore'
import { geminiEmbed } from '@/lib/ai/geminiEmbed'

const SIGNAL_WEIGHT: Record<string, number> = { canva_import: 40, download: 25 }

async function canAccess(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const pages: { pageId: string }[] = viewer.data()?.pages ?? []
  return pages.some(p => p.pageId === pageId)
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const body = await req.json().catch(() => ({}))
  const pageId: string = body.pageId ?? ''
  const prompt: string = (body.prompt ?? '').toString().trim()
  const signal: string = body.signal ?? ''
  const goal: string | null = body.goal ?? null
  if (!pageId || !prompt || !SIGNAL_WEIGHT[signal]) {
    return NextResponse.json({ error: 'pageId, prompt, valid signal required' }, { status: 400 })
  }
  if (!(await canAccess(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Best-effort prompt embedding for Phase-2 semantic retrieval.
  let embedding: number[] | null = null
  try {
    const key = process.env.GEMINI_API_KEY
    if (key) embedding = await geminiEmbed(prompt, key)
  } catch { /* retrieval falls back to metadata */ }

  // Dedup by prompt hash so re-importing the same prompt updates in place.
  const docId = `creative__${createHash('sha1').update(prompt).digest('hex').slice(0, 16)}`
  await writeFeedback(pageId, {
    source: 'creative', goal,
    output: prompt,
    signal, signalWeight: SIGNAL_WEIGHT[signal],
    byUid: uid, embedding,
  }, docId).catch(() => {})

  return NextResponse.json({ ok: true })
}
