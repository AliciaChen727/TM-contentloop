export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { FieldValue } from 'firebase-admin/firestore'
import type { DiagItem, AiDiagCard } from '@/components/ads/types'
import {
  computeDiagFingerprint, selectItemsForAgent, agentSystemPrompt, agentUserMessage, parseAndEnforceCards,
} from '@/lib/ads/diagnosisAgent'

// Does this uid have read access to pageId? Mirrors api/ads/data: owner (own
// snapshot), admin, viewer (with ads permission), or super-admin.
async function canAccessPage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const pages: { pageId: string; permissions?: { ads?: boolean } }[] = viewer.data()?.pages ?? []
  return pages.some((p) => p.pageId === pageId && p.permissions?.ads)
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { pageId, items, summary } = (await req.json()) as {
    pageId?: string; items?: DiagItem[]; summary?: Record<string, number>
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canAccessPage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const allItems = Array.isArray(items) ? items : []
  const selected = selectItemsForAgent(allItems)
  if (selected.length === 0) return NextResponse.json({ cards: [], fingerprint: null })

  const fingerprint = computeDiagFingerprint(allItems)
  const latestRef = adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest')

  // Cache hit: stored fingerprint matches → return stored cards, no LLM call.
  const cached = (await latestRef.get()).data()
  if (cached?.aiDiagnosisFingerprint === fingerprint && Array.isArray(cached.aiDiagnosis)) {
    return NextResponse.json({ cards: cached.aiDiagnosis as AiDiagCard[], fingerprint, cached: true })
  }

  const anthropicKey = (await getUserApiKey(uid, 'anthropic')) ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })

  let cards: AiDiagCard[] | null
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system: [{ type: 'text', text: agentSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: agentUserMessage(allItems, summary ?? {}) }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    cards = parseAndEnforceCards(raw, allItems)
  } catch {
    return NextResponse.json({ error: 'AI 診斷生成失敗，請再試一次', fallback: true }, { status: 200 })
  }
  if (!cards) return NextResponse.json({ error: 'AI 回應格式異常', fallback: true }, { status: 200 })

  // Cache on the canonical snapshot doc so the cron/email sink (Slice 4) reuses it.
  await latestRef.set({
    aiDiagnosis: cards,
    aiDiagnosisFingerprint: fingerprint,
    aiDiagnosisUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return NextResponse.json({ cards, fingerprint, cached: false })
}
