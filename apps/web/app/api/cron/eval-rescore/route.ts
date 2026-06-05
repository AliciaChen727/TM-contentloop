/**
 * Daily Quality re-score batch (Phase 3 self-learning, Slice B).
 *
 * Runs once a day (GitHub Action → CRON_SECRET). For every page's sidekickFeedback
 * doc that has a humanAction:
 *  1. If adopted ≥7 days ago and metricsBefore exists → compute adMetricsAfter from
 *     the (daily-synced) adInsights summary: delta = now − before. Account-level.
 *  2. Re-score with the behavior-aware evaluator (humanAction / adoptedText /
 *     adMetricsAfter) → write evalScore(1–10) / evalReasons / weakestDimension /
 *     recommendToFewShot back to the doc.
 *  3. Aggregate per alertType → pages/{pageId}/qualityStats/{alertType}.
 *
 * Cost guard: a doc is scored at most twice — once after the humanAction, once
 * after the 7-day effect window opens. Flags: behaviorRescoredAt, effectScored.
 * No Meta call here — adInsights/latest is kept fresh by the daily ad sync.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { evaluateOutput, type EvalInput, type AdMetricsAfter } from '@/lib/sidekick/evaluator'
import { patchFeedbackEval } from '@/lib/sidekick/feedbackStore'

const SEVEN_DAYS = 7 * 864e5
const norm10 = (v: unknown) => (typeof v === 'number' ? (v <= 5 ? v * 2 : v) : 0)

interface Metrics { ctr: number; cpc: number; roas: number }
const toMetrics = (s: Record<string, unknown> = {}): Metrics => ({
  ctr: Number(s.ctr) || 0, cpc: Number(s.cpa ?? s.cpc) || 0, roas: Number(s.roas) || 0,
})

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keys = { geminiKey: process.env.GEMINI_API_KEY ?? null, anthropicKey: process.env.ANTHROPIC_API_KEY ?? null }
  if (!keys.geminiKey && !keys.anthropicKey) {
    return NextResponse.json({ error: 'No evaluator key configured' }, { status: 500 })
  }

  const now = Date.now()
  let pagesProcessed = 0, scored = 0, effectComputed = 0, executedDetected = 0, specificDetected = 0

  const pages = await adminDb.collection('pages').get()
  for (const page of pages.docs) {
    const pageId = page.id
    pagesProcessed++

    const snapData = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data() ?? {}
    const metricsNow = toMetrics(snapData.summary as Record<string, unknown>)
    const fpNow = (snapData.creativeFingerprint as string | undefined) ?? ''
    const fieldFpNow = (snapData.adFieldFingerprints as Record<string, { copy?: string }> | undefined) ?? {}

    const fbCol = adminDb.collection('pages').doc(pageId).collection('sidekickFeedback')
    const fbSnap = await fbCol.orderBy('createdAt', 'desc').limit(500).get()

    // For qualityStats aggregation.
    const byType = new Map<string, { sum: number; n: number; adopted: number; top: { id: string; score: number } | null }>()

    for (const doc of fbSnap.docs) {
      const d = doc.data()
      const humanAction = d.humanAction as 'adopted' | 'edited' | 'rejected' | undefined
      if (!humanAction) continue

      // 0) Execution detection (Slice E): an adopted card counts as EXECUTED only
      // when the creative set actually changed since adoption (fingerprint diff) —
      // turns "標示完成" into a verified "真的去改了素材" signal.
      if (humanAction === 'adopted' && d.execBeforeFp && !d.executed && fpNow && fpNow !== d.execBeforeFp) {
        await fbCol.doc(doc.id).set({ executed: true, executedAt: FieldValue.serverTimestamp() }, { merge: true })
        d.executed = true
        executedDetected++
      }

      // 0b) Specificity matching: for a card that targeted a specific creative,
      // verify THAT creative changed — its copy edited ('copy') or the creative
      // gone/replaced ('creative_replaced') — not just "some creative changed".
      if (humanAction === 'adopted' && d.execTargetId && d.execTargetCopyHash && !d.executedSpecific) {
        const cur = fieldFpNow[d.execTargetId as string]
        const field = !cur ? 'creative_replaced'              // targeted creative gone/replaced
          : (cur.copy && cur.copy !== d.execTargetCopyHash) ? 'copy'  // its copy edited
          : null
        if (field) {
          await fbCol.doc(doc.id).set({
            executedSpecific: true, executedSpecificAt: FieldValue.serverTimestamp(), specificChangedField: field,
          }, { merge: true })
          d.executedSpecific = true
          specificDetected++
        }
      }

      // 1) 7-day effect window → compute adMetricsAfter once.
      let adMetricsAfter = (d.adMetricsAfter as AdMetricsAfter | undefined) ?? null
      let willEffectScore = false
      const adoptedAtMs = d.adoptedAt?.toMillis?.() ?? null
      if (humanAction === 'adopted' && d.metricsBefore && adoptedAtMs && (now - adoptedAtMs) >= SEVEN_DAYS && !d.effectScored) {
        const before = d.metricsBefore as Metrics
        adMetricsAfter = {
          ctr: metricsNow.ctr, cpc: metricsNow.cpc, roas: metricsNow.roas,
          deltaVsBefore: {
            ctr: Number((metricsNow.ctr - before.ctr).toFixed(2)),
            cpc: Number((metricsNow.cpc - before.cpc).toFixed(2)),
            roas: Number((metricsNow.roas - before.roas).toFixed(2)),
          },
        }
        willEffectScore = true
      }

      // 2) Score at most twice: first after humanAction, again when effect opens.
      const shouldScore = !d.behaviorRescoredAt || willEffectScore
      if (shouldScore) {
        const input: EvalInput = {
          kind: (d.source === 'sidekick' ? 'sidekick' : 'diagnosis'),
          output: String(d.output ?? d.adoptedText ?? ''),
          context: String(d.context ?? ''),
          goal: (d.goal as string) ?? null,
          humanAction,
          adoptedText: (d.adoptedText as string) ?? null,
          adMetricsAfter,
        }
        const result = await evaluateOutput(input, keys)
        if (result.judge !== 'none') {
          await patchFeedbackEval(pageId, doc.id, {
            evalScore: result.evalScore, evalReasons: result.evalReasons,
            weakestDimension: result.weakestDimension, recommendToFewShot: result.recommendToFewShot,
            adMetricsAfter: adMetricsAfter as Record<string, unknown> | null,
          })
          await fbCol.doc(doc.id).set(
            { behaviorRescoredAt: FieldValue.serverTimestamp(), ...(willEffectScore ? { effectScored: true } : {}) },
            { merge: true },
          )
          scored++
          if (willEffectScore) effectComputed++
          d.evalScore = result.evalScore  // reflect in this run's aggregation
        }
      }

      // 3) Aggregate per alertType.
      const t = String(d.alertType ?? 'unknown')
      const agg = byType.get(t) ?? { sum: 0, n: 0, adopted: 0, top: null }
      const score = norm10(d.evalScore)
      agg.sum += score; agg.n++
      if (humanAction === 'adopted') {
        agg.adopted++
        if (!agg.top || score > agg.top.score) agg.top = { id: doc.id, score }
      }
      byType.set(t, agg)
    }

    // Write qualityStats per alertType (page-scoped for isolation).
    for (const [alertType, a] of Array.from(byType)) {
      await adminDb.collection('pages').doc(pageId).collection('qualityStats').doc(alertType).set({
        alertType,
        avgEvalScore: a.n ? Number((a.sum / a.n).toFixed(2)) : 0,
        adoptedRate: a.n ? Number((a.adopted / a.n).toFixed(2)) : 0,
        sampleCount: a.n,
        topAdoptedExample: a.top?.id ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  }

  return NextResponse.json({ ok: true, pagesProcessed, scored, effectComputed, executedDetected, specificDetected })
}
