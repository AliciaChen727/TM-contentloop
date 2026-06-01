// Server-only side of the diagnosis Agent: the Haiku call + the fingerprint cache
// on pages/{pageId}/adInsights/latest. Shared by app/api/ai/diagnosis/route.ts
// (page) and lib/alerts/processAlerts.ts (cron → email/bell), so both produce and
// reuse the SAME cards. Pure helpers stay in diagnosisAgent.ts.

import Anthropic from '@anthropic-ai/sdk'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { DiagItem, AiDiagCard } from '@/components/ads/types'
import {
  computeDiagFingerprint, selectItemsForAgent, agentSystemPrompt, agentUserMessage, parseAndEnforceCards,
} from '@/lib/ads/diagnosisAgent'

// One Haiku call → enforced cards (or null on failure / bad output).
export async function runDiagnosisAgent(
  items: DiagItem[], summary: Record<string, number>, apiKey: string,
): Promise<AiDiagCard[] | null> {
  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system: [{ type: 'text', text: agentSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: agentUserMessage(items, summary) }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseAndEnforceCards(raw, items)
  } catch {
    return null
  }
}

// Read the fingerprint cache; regenerate + store on miss. Returns null when there
// is nothing to diagnose or generation failed (callers fall back to rule text).
export async function getOrGenerateDiagnosisCards(
  pageId: string, items: DiagItem[], summary: Record<string, number>, apiKey: string,
): Promise<AiDiagCard[] | null> {
  if (selectItemsForAgent(items).length === 0) return null
  const fingerprint = computeDiagFingerprint(items)
  const latestRef = adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest')

  const cached = (await latestRef.get()).data()
  if (cached?.aiDiagnosisFingerprint === fingerprint && Array.isArray(cached.aiDiagnosis)) {
    return cached.aiDiagnosis as AiDiagCard[]
  }

  const cards = await runDiagnosisAgent(items, summary, apiKey)
  if (!cards) return null

  await latestRef.set({
    aiDiagnosis: cards,
    aiDiagnosisFingerprint: fingerprint,
    aiDiagnosisUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return cards
}
