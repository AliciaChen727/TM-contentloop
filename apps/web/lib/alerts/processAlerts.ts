import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { FieldValue } from 'firebase-admin/firestore'
import { detectAdAlerts } from './detector'
import { sendAlertEmail } from './emailSender'

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

  // Latest snapshot → detect
  const snap = (await adminDb.collection('pages').doc(pageId).collection('adInsights').doc('latest').get()).data()
  if (!snap) return { sent: false, reason: 'no snapshot' }
  const alerts = detectAdAlerts(snap)
  if (alerts.length === 0) return { sent: false, reason: 'no alerts', alertCount: 0 }

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

  // Send full current digest to all recipients
  const results = await Promise.all(recipients.map(to => sendAlertEmail(to, pageName, alerts, pageId)))
  const result = results.find(r => r.ok) ?? results[0]

  await stateRef.set({
    sentKeys: alerts.map(a => a.key),
    lastScheduledSendDate: result.ok ? dateStr : (lastState.lastScheduledSendDate ?? null),
    lastSentAt: result.ok ? FieldValue.serverTimestamp() : (lastState.lastSentAt ?? null),
    lastError: result.ok ? null : (result.error ?? 'unknown'),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { sent: result.ok, reason: result.error, alertCount: alerts.length }
}
