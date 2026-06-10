// Server-only helpers for short links (Admin SDK). Records a conversion against
// a link, de-duplicating by clickId so a page refresh / repeat webhook can't
// double-count the same registration — then (B-ROAS①) reports it to Meta via the
// Conversions API so Ads Manager can compute ROAS.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decrypt } from '@/lib/encrypt'
import { sendCapiEvent } from '@/lib/meta/capi'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tm-contentloop.vercel.app'

export async function recordConversion(
  pageId: string, slug: string, clickId: string | null, via: 'redirect' | 'webhook',
): Promise<{ counted: boolean }> {
  const linkRef = adminDb.collection('pages').doc(pageId).collection('links').doc(slug)
  const convCol = linkRef.collection('conversions')

  // Deterministic id when we know the click → idempotent (no double count).
  const convRef = clickId ? convCol.doc(clickId) : convCol.doc()
  if (clickId) {
    const existing = await convRef.get()
    if (existing.exists) return { counted: false }
  }
  await Promise.all([
    convRef.set({ ts: FieldValue.serverTimestamp(), clickId: clickId ?? null, via }),
    linkRef.set({ conversionCount: FieldValue.increment(1), lastConversionAt: FieldValue.serverTimestamp() }, { merge: true }),
  ])

  // Best-effort: report to Meta. Never let a Meta failure affect the conversion.
  try { await sendToMeta(pageId, slug, clickId, linkRef) } catch { /* swallow */ }
  return { counted: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToMeta(pageId: string, slug: string, clickId: string | null, linkRef: any): Promise<void> {
  const cfgSnap = await adminDb.collection('pages').doc(pageId).collection('integrations').doc('metaCapi').get()
  const cfg = cfgSnap.data()
  if (!cfg || cfg.enabled === false || !cfg.pixelId || !cfg.accessTokenEnc) return

  const link = (await linkRef.get()).data() ?? {}
  const value = Number(link.value ?? 0)
  const currency = (link.currency as string) ?? 'TWD'
  // Paid event → Purchase(value); free event → CompleteRegistration (no ROAS).
  const eventName = value > 0 ? 'Purchase' : 'CompleteRegistration'

  // Pull the click's matching signals (fbc / raw ip / ua) captured at /r.
  let fbc: string | null = null, ip: string | null = null, ua: string | null = null
  if (clickId) {
    const clk = (await linkRef.collection('clicks').doc(clickId).get()).data()
    const capi = clk?.capi ?? {}
    fbc = capi.fbc ?? null; ip = capi.rawIp ?? null; ua = capi.rawUa ?? null
  }

  let accessToken: string
  try { accessToken = decrypt(cfg.accessTokenEnc as string) } catch { return }

  const res = await sendCapiEvent({
    pixelId: cfg.pixelId as string,
    accessToken,
    eventName,
    eventId: clickId ?? `${slug}-${Date.now()}`,
    eventSourceUrl: `${APP_BASE}/c/${slug}`,
    fbc, ip, ua,
    value, currency,
  })
  // Record the outcome on the conversion doc for transparency / debugging.
  const convRef = clickId ? linkRef.collection('conversions').doc(clickId) : null
  if (convRef) await convRef.set({ capi: { ok: res.ok, error: res.error ?? null, eventName, value } }, { merge: true })
}
