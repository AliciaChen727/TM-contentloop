import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { FieldValue } from 'firebase-admin/firestore'
import { detectAdAlerts, type AdAlert } from './detector'
import { sendAlertEmail } from './emailSender'

export type AlertFrequency = 'daily' | 'weekly' | 'off'

// Taiwan weekday (0 = Sunday). Weekly digests go out on Monday (1).
function taiwanWeekday(): number {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCDay()
}

// Run detection + (frequency-aware, deduped) email for ONE page. Called after the
// daily sync writes pages/{pageId}/adInsights/latest. Safe to call for every page.
export async function processPageAlerts(pageId: string): Promise<{
  sent: boolean; reason?: string; alertCount?: number
}> {
  // 1. Settings (default: daily)
  const profile = (await adminDb.collection('pages').doc(pageId).get()).data() ?? {}
  const frequency = (profile.alertFrequency ?? 'daily') as AlertFrequency
  if (frequency === 'off') return { sent: false, reason: 'off' }

  // 2. Latest snapshot → detect
  const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data()
  if (!snap) return { sent: false, reason: 'no snapshot' }
  const alerts = detectAdAlerts(snap)
  if (alerts.length === 0) return { sent: false, reason: 'no alerts', alertCount: 0 }

  // 3. Dedup against last-sent state
  const stateRef = adminDb.collection('pages').doc(pageId).collection('alertState').doc('current')
  const lastState = (await stateRef.get()).data() ?? {}
  const lastKeys: string[] = lastState.sentKeys ?? []

  let toSend: AdAlert[]
  if (frequency === 'weekly') {
    // Weekly digest: only on Monday, send everything currently flagged.
    if (taiwanWeekday() !== 1) {
      await stateRef.set({ sentKeys: alerts.map(a => a.key), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return { sent: false, reason: 'weekly: not monday', alertCount: alerts.length }
    }
    toSend = alerts
  } else {
    // Daily: only alerts that are NEW since last send (avoid daily repeats).
    toSend = alerts.filter(a => !lastKeys.includes(a.key))
    if (toSend.length === 0) {
      await stateRef.set({ sentKeys: alerts.map(a => a.key), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return { sent: false, reason: 'daily: no new alerts', alertCount: alerts.length }
    }
  }

  // 4. Recipient emails. Priority:
  //    explicit alertEmails → legacy alertEmail → configuring admin's login
  //    email → page owner's email (last resort).
  let recipients: string[] = profile.alertEmails ?? []
  if (recipients.length === 0 && profile.alertEmail) recipients = [profile.alertEmail]
  if (recipients.length === 0) {
    const fallbackUid = profile.alertConfiguredByUid ?? await resolvePageOwnerUid(pageId)
    if (fallbackUid) {
      try { const email = (await adminAuth.getUser(fallbackUid)).email ?? ''; if (email) recipients = [email] } catch { /* no auth user */ }
    }
  }
  if (recipients.length === 0) return { sent: false, reason: 'no recipient email', alertCount: alerts.length }

  // 5. Send to all recipients + record state
  const pageName = profile.pageName ?? profile.brandName ?? pageId
  const results = await Promise.all(recipients.map(to => sendAlertEmail(to, pageName, toSend)))
  const result = results.find(r => r.ok) ?? results[0]
  await stateRef.set({
    sentKeys: alerts.map(a => a.key),
    lastSentAt: result.ok ? FieldValue.serverTimestamp() : (lastState.lastSentAt ?? null),
    lastError: result.ok ? null : (result.error ?? 'unknown'),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { sent: result.ok, reason: result.error, alertCount: toSend.length }
}
