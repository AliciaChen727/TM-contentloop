import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { AdAlert } from '@/lib/alerts/detector'

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

// Rule-based optimization advice per alert type (Phase 2). Phase 3 upgrades this
// to LLM-generated, ad-specific advice — see docs/phase-3-sidekick-self-learning.md.
const ADVICE_BY_TYPE: Record<AdAlert['type'], string> = {
  ctr_drop: 'CTR 下滑通常是素材疲乏，建議更換主視覺或重寫開頭 hook 文案。',
  frequency_high: '曝光頻次過高代表受眾被洗版，建議擴大受眾或調降預算/換素材。',
  cpc_spike: 'CPC 飆高多為競價或相關性下降，建議檢查受眾精準度與素材相關度分數。',
}

// Build a combined advice string covering each distinct alert type present.
export function buildAdvice(alerts: AdAlert[]): string {
  const types = Array.from(new Set(alerts.map((a) => a.type)))
  return types.map((t) => ADVICE_BY_TYPE[t]).filter(Boolean).join('\n')
}

// Resolve a digest notification payload for a batch of ad alerts.
export function buildAdAnomalyNotification(
  pageId: string,
  pageName: string,
  alerts: AdAlert[],
  dateStr: string,
): NotificationInput {
  const body = alerts.map((a) => `• ${a.message}`).join('\n')
  return {
    type: 'ad_anomaly',
    pageId,
    pageName,
    title: `${pageName}：${alerts.length} 則廣告出現異常`,
    body,
    advice: buildAdvice(alerts),
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
