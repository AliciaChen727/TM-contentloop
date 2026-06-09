import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { FieldValue } from 'firebase-admin/firestore'
import { sendAlertEmail } from './emailSender'
import { computeDiagnosisFromSnapshot, diagnosisToAlertItems } from '@/lib/ads/diagnosis'
import { getOrGenerateDiagnosisCards } from '@/lib/ads/diagnosisAgentServer'
import { loadContentDiagnosis } from '@/lib/ads/contentDiagnosisServer'
import { diagnosisCardKey, severityRank } from '@/lib/ads/diagnosisCardKey'
import { getUserApiKey } from '@/lib/userApiKeys'
import type { DiagItem, AiDiagCard } from '@/components/ads/types'
import type { AlertItem } from '@/lib/alerts/types'
import type { Timestamp } from 'firebase-admin/firestore'
import { writeInAppNotification, resolveUidsFromEmails, buildAdAnomalyNotification } from '@/lib/notifications/store'

// Taiwan (UTC+8) wall-clock components.
function taiwanNow(): { weekday: number; hour: number; dateStr: string } {
  const t = new Date(Date.now() + 8 * 3600 * 1000)
  return {
    weekday: t.getUTCDay(),          // 0 = Sunday … 6 = Saturday
    hour: t.getUTCHours(),           // 0–23
    dateStr: t.toISOString().slice(0, 10), // YYYY-MM-DD
  }
}

interface AlertSchedule {
  enabled: boolean
  days: number[]   // Taiwan weekdays (0=Sun … 6=Sat)
  hour: number     // 0–23 Taiwan time
}

// Resolve schedule from page profile, migrating legacy alertFrequency settings.
function resolveSchedule(profile: Record<string, unknown>): AlertSchedule {
  // New-style fields take precedence
  if (typeof profile.alertEnabled === 'boolean') {
    return {
      enabled: profile.alertEnabled,
      days: Array.isArray(profile.alertDays) ? (profile.alertDays as number[]) : [0, 1, 2, 3, 4, 5, 6],
      hour: typeof profile.alertHour === 'number' ? (profile.alertHour as number) : 9,
    }
  }
  // Legacy migration: daily / weekly / off
  const freq = (profile.alertFrequency ?? 'off') as string
  if (freq === 'off') return { enabled: false, days: [], hour: 9 }
  if (freq === 'weekly') return { enabled: true, days: [1], hour: 9 } // Monday
  return { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 9 }       // daily
}

// Run detection + scheduled email for ONE page. Intended to be called hourly by
// /api/cron/send-alerts. Sends the current alert digest when the page's
// scheduled day+hour has arrived and nothing has been sent yet today.
export async function processPageAlerts(pageId: string): Promise<{
  sent: boolean; reason?: string; alertCount?: number
}> {
  const profile = (await adminDb.collection('pages').doc(pageId).get()).data() ?? {}
  const schedule = resolveSchedule(profile)
  if (!schedule.enabled) return { sent: false, reason: 'off' }

  const { weekday, hour, dateStr } = taiwanNow()

  // Schedule gates
  if (!schedule.days.includes(weekday)) return { sent: false, reason: 'not a scheduled day' }
  if (hour < schedule.hour) return { sent: false, reason: 'before scheduled hour' }

  // Once-per-day guard (also makes us resilient to delayed/duplicate cron runs)
  const stateRef = adminDb.collection('pages').doc(pageId).collection('alertState').doc('current')
  const lastState = (await stateRef.get()).data() ?? {}
  if (lastState.lastScheduledSendDate === dateStr) {
    return { sent: false, reason: 'already sent today' }
  }

  // Latest snapshot → diagnosis. Prefer the diagnosis stored at sync time; fall
  // back to recomputing from the snapshot when it's missing or stale (older than
  // the latest sync). Same engine as the 診斷建議 page → 紅點 stays in sync.
  const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data()
  if (!snap) return { sent: false, reason: 'no snapshot' }

  const syncedMs = (snap.syncedAt as Timestamp | undefined)?.toMillis?.() ?? 0
  const diagMs = (snap.diagnosisUpdatedAt as Timestamp | undefined)?.toMillis?.() ?? 0
  const storedDiag = Array.isArray(snap.diagnosis) ? (snap.diagnosis as DiagItem[]) : null
  const adItems = storedDiag && diagMs >= syncedMs
    ? storedDiag
    : computeDiagnosisFromSnapshot(snap).items

  // Merge content (post) diagnosis so the digest covers 廣告 + 貼文. Page-scoped,
  // isolation-safe. Best-effort: [] on any failure.
  const ownerUid = await resolvePageOwnerUid(pageId)
  let items = adItems
  if (ownerUid) {
    const contentItems = await loadContentDiagnosis(
      ownerUid, pageId,
      Array.isArray(snap.adPostIds) ? (snap.adPostIds as string[]) : [],
      Array.isArray(snap.igPostIds) ? (snap.igPostIds as string[]) : [],
      (snap.summary ?? {}) as { cpm?: number },
    )
    if (contentItems.length > 0) {
      items = [...adItems.filter(d => d.id !== 'd0'), ...contentItems]
    }
  }

  // Respect the dashboard's card statuses (Slice 7):
  //   dismissed → always silent;
  //   completed → silent UNLESS it has escalated (current severity worse than when
  //               marked done) — then re-notify AND reopen the card.
  const statusSnap = await adminDb.collection('pages').doc(pageId).collection('diagnosisCardStatus').get()
  const statusMap = new Map<string, { status: string; severityRank: number }>()
  for (const d of statusSnap.docs) {
    const v = d.data()
    statusMap.set(d.id, { status: v.status, severityRank: typeof v.severityRank === 'number' ? v.severityRank : 0 })
  }
  const reopen: string[] = []
  items = items.filter((d) => {
    const st = statusMap.get(diagnosisCardKey(d))
    if (!st) return true
    if (st.status === 'dismissed') return false
    if (st.status === 'completed') {
      if (severityRank(d.severity) > st.severityRank) { reopen.push(diagnosisCardKey(d)); return true }
      return false
    }
    return true
  })
  // Reopen escalated completed cards so the dashboard reflects they're live again.
  await Promise.all(reopen.map((k) =>
    adminDb.collection('pages').doc(pageId).collection('diagnosisCardStatus').doc(k).delete().catch(() => {})))

  const alerts = diagnosisToAlertItems(items)
  if (alerts.length === 0) return { sent: false, reason: 'no alerts', alertCount: 0 }

  // The set of "live" cards after status filtering (keys are language-stable, so
  // the same survivors apply regardless of which language we render in).
  const survivingKeys = new Set(items.map(diagnosisCardKey))
  const summary = (snap.summary ?? {}) as Record<string, number>
  const adPostIds = Array.isArray(snap.adPostIds) ? (snap.adPostIds as string[]) : []
  const igPostIds = Array.isArray(snap.igPostIds) ? (snap.igPostIds as string[]) : []
  let apiKey = process.env.ANTHROPIC_API_KEY ?? null
  if (!apiKey && ownerUid) apiKey = await getUserApiKey(ownerUid, 'anthropic')
  let geminiKey = process.env.GEMINI_API_KEY ?? null
  if (!geminiKey && ownerUid) geminiKey = await getUserApiKey(ownerUid, 'gemini')

  // Per-language digest (recipients may have different language prefs). Memoized:
  // recompute diagnosis text in the target language, filter to the live survivors,
  // then run the Agent rewrite (fingerprint cache is language-distinct).
  const digestCache = new Map<boolean, { alerts: AlertItem[]; cards: AiDiagCard[] | null }>()
  async function digestFor(en: boolean): Promise<{ alerts: AlertItem[]; cards: AiDiagCard[] | null }> {
    const cached = digestCache.get(en)
    if (cached) return cached
    // zh fast-path can reuse the stored snapshot diagnosis; en must recompute.
    const ad = (storedDiag && diagMs >= syncedMs && !en) ? storedDiag : computeDiagnosisFromSnapshot(snap, en).items
    let its = ad
    if (ownerUid) {
      const content = await loadContentDiagnosis(ownerUid, pageId, adPostIds, igPostIds, summary, en).catch(() => [])
      if (content.length > 0) its = [...ad.filter(d => d.id !== 'd0'), ...content]
    }
    its = its.filter(d => survivingKeys.has(diagnosisCardKey(d)))
    let cards: AiDiagCard[] | null = null
    try {
      if (apiKey) cards = await getOrGenerateDiagnosisCards(pageId, its, summary, apiKey, { geminiKey, anthropicKey: apiKey }, en)
    } catch (e) {
      console.error('[processPageAlerts] diagnosis agent failed', e)
    }
    const out = { alerts: diagnosisToAlertItems(its), cards }
    digestCache.set(en, out)
    return out
  }

  // Resolve a uid's UI language preference (English?). Defaults to zh on any miss.
  async function uidIsEn(uid: string | null | undefined): Promise<boolean> {
    if (!uid) return false
    try {
      const p = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
      return p.data()?.language === 'en'
    } catch { return false }
  }

  // Recipient emails. Priority:
  //   explicit alertEmails → legacy alertEmail → configuring admin's login
  //   email → page owner's email (last resort).
  let recipients: string[] = profile.alertEmails ?? []
  if (recipients.length === 0 && profile.alertEmail) recipients = [profile.alertEmail]
  if (recipients.length === 0) {
    const fallbackUid = (profile.alertConfiguredByUid as string) ?? await resolvePageOwnerUid(pageId)
    if (fallbackUid) {
      try { const email = (await adminAuth.getUser(fallbackUid)).email ?? ''; if (email) recipients = [email] } catch { /* no auth user */ }
    }
  }
  if (recipients.length === 0) return { sent: false, reason: 'no recipient email', alertCount: alerts.length }

  // Resolve a human page name. pages/{pageId} docs are often phantom, so fall
  // back to the owner's metaTokens (where the real FB page name lives).
  let pageName: string = (profile.pageName as string) ?? (profile.brandName as string) ?? ''
  if (!pageName) {
    const ownerUid = await resolvePageOwnerUid(pageId)
    if (ownerUid) {
      const tok = await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
      pageName = tok.data()?.pageName ?? ''
    }
  }
  if (!pageName) pageName = pageId

  // Send the digest to each recipient in THEIR language (email maps to an account
  // → its language pref; unknown emails fall back to zh).
  const results = await Promise.all(recipients.map(async (to) => {
    const uids = await resolveUidsFromEmails([to]).catch(() => [] as string[])
    const en = await uidIsEn(uids[0])
    const d = await digestFor(en)
    return sendAlertEmail(to, pageName, d.alerts, pageId, d.cards, en)
  }))
  const result = results.find(r => r.ok) ?? results[0]

  // In-app notification sink (Phase 2, option A — alongside the scheduled email).
  // Fan out to recipient admins by UID, each in their own language. The
  // deterministic per-day doc id makes this idempotent across cron re-runs.
  let inAppWritten = 0
  try {
    const emailUids = await resolveUidsFromEmails(recipients)
    const configuredByUid = (profile.alertConfiguredByUid as string) ?? null
    const targetUids = Array.from(new Set([...emailUids, ...(configuredByUid ? [configuredByUid] : [])]))
    for (const uid of targetUids) {
      const en = await uidIsEn(uid)
      const d = await digestFor(en)
      const notif = buildAdAnomalyNotification(pageId, pageName, d.alerts, dateStr, d.cards, en)
      const res = await writeInAppNotification([uid], notif)
      inAppWritten += res.written
    }
  } catch (e) {
    // In-app failure must not break the email flow.
    console.error('[processPageAlerts] in-app notification failed', e)
  }

  await stateRef.set({
    sentKeys: alerts.map(a => a.key),
    lastScheduledSendDate: result.ok ? dateStr : (lastState.lastScheduledSendDate ?? null),
    lastSentAt: result.ok ? FieldValue.serverTimestamp() : (lastState.lastSentAt ?? null),
    lastError: result.ok ? null : (result.error ?? 'unknown'),
    lastInAppNotifDate: inAppWritten > 0 ? dateStr : (lastState.lastInAppNotifDate ?? null),
    lastInAppNotifCount: inAppWritten,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { sent: result.ok, reason: result.error, alertCount: alerts.length }
}
