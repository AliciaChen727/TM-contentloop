import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { AlertItem } from '@/lib/alerts/types'

// Phase 2 — in-app notification center.
// Writes notifications to users/{uid}/notifications, fanned out to each recipient
// admin. Shares the same detection source as the email alerts (detectAdAlerts);
// this is just an additional sink. See docs/phase-2-notification-center.md.

export type NotificationType = 'ad_anomaly' | 'report_ready' | 'invite' | 'system'

export interface NotificationInput {
  type: NotificationType
  pageId: string
  pageName: string
  title: string
  body: string
  advice: string
  actionPrompt?: string | null   // Phase 3 — left null for now
  alertKeys: string[]
  deepLink: string
  dateStr: string                // YYYY-MM-DD, used for per-day dedup id
}

// Resolve a digest notification payload for a batch of alert items. The advice
// comes straight from the diagnosis engine (DiagItem.action) so the 紅點 matches
// the 診斷建議 page. Phase 3 upgrades advice to LLM-generated, ad-specific text —
// see docs/phase-3-sidekick-self-learning.md.
export function buildAdAnomalyNotification(
  pageId: string,
  pageName: string,
  alerts: AlertItem[],
  dateStr: string,
): NotificationInput {
  const body = alerts.map((a) => `${a.emoji} ${a.title}：${a.message}`).join('\n')
  const advice = Array.from(new Set(alerts.map((a) => a.advice).filter(Boolean))).join('\n')
  return {
    type: 'ad_anomaly',
    pageId,
    pageName,
    title: `${pageName}：${alerts.length} 項廣告需要注意`,
    body,
    advice,
    actionPrompt: null,
    alertKeys: alerts.map((a) => a.key),
    deepLink: `/dashboard/ads?pageId=${pageId}`,
    dateStr,
  }
}

// Resolve auth UIDs from a list of emails. Unknown emails are skipped silently
// (those recipients still get the email, just not the in-app notification).
export async function resolveUidsFromEmails(emails: string[]): Promise<string[]> {
  const uids = await Promise.all(
    emails.map(async (email) => {
      try {
        return (await adminAuth.getUserByEmail(email)).uid
      } catch {
        return null
      }
    }),
  )
  return Array.from(new Set(uids.filter((u): u is string => !!u)))
}

// Fan-out write to each recipient. Uses a deterministic per-day doc id
// (`{type}__{pageId}__{dateStr}`) so re-runs on the same day update in place
// rather than spamming, and never clobber a notification the user already read.
export async function writeInAppNotification(
  recipientUids: string[],
  n: NotificationInput,
): Promise<{ written: number }> {
  const uids = Array.from(new Set(recipientUids.filter(Boolean)))
  if (uids.length === 0) return { written: 0 }

  const docId = `${n.type}__${n.pageId}__${n.dateStr}`
  const content = {
    type: n.type,
    pageId: n.pageId,
    pageName: n.pageName,
    title: n.title,
    body: n.body,
    advice: n.advice,
    actionPrompt: n.actionPrompt ?? null,
    alertKeys: n.alertKeys,
    deepLink: n.deepLink,
    updatedAt: FieldValue.serverTimestamp(),
  }

  await Promise.all(
    uids.map(async (uid) => {
      const ref = adminDb.collection('users').doc(uid).collection('notifications').doc(docId)
      const existing = await ref.get()
      if (existing.exists) {
        // Update content only — preserve read / readAt / createdAt.
        await ref.set(content, { merge: true })
      } else {
        await ref.set({ ...content, read: false, readAt: null, createdAt: FieldValue.serverTimestamp() })
      }
    }),
  )

  return { written: uids.length }
}
