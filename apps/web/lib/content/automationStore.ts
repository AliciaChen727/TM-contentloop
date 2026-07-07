// Per-page automation settings (Agent 自動發布 S5a). Governs the scheduled-
// publish cron: a Kill Switch to freeze all auto-publishing, and quiet hours
// (Taiwan time) during which scheduled posts are deferred, not sent.
// Stored at pages/{pageId}/automationSettings/config.

import { adminDb } from '@/lib/firebase/admin'

export interface AutomationSettings {
  killSwitch: boolean
  quietHours: { start: number; end: number } | null   // hours 0–23 (Taiwan), [start, end)
  updatedByUid?: string
  updatedAt?: number
}

const DEFAULTS: AutomationSettings = { killSwitch: false, quietHours: null }

const ref = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('automationSettings').doc('config')

export async function getAutomationSettings(pageId: string): Promise<AutomationSettings> {
  const d = await ref(pageId).get()
  if (!d.exists) return { ...DEFAULTS }
  const data = d.data() ?? {}
  return {
    killSwitch: !!data.killSwitch,
    quietHours: data.quietHours ?? null,
    updatedByUid: data.updatedByUid,
    updatedAt: data.updatedAt,
  }
}

export async function setAutomationSettings(
  pageId: string, patch: Partial<Pick<AutomationSettings, 'killSwitch' | 'quietHours'>>, byUid: string,
): Promise<AutomationSettings> {
  await ref(pageId).set({ ...patch, updatedByUid: byUid, updatedAt: Date.now() }, { merge: true })
  return getAutomationSettings(pageId)
}

// Is the current moment inside the quiet window? Taiwan is UTC+8; handles a
// window that wraps past midnight (e.g., 22 → 8).
export function inQuietHours(q: { start: number; end: number } | null, now = new Date()): boolean {
  if (!q) return false
  const twHour = (now.getUTCHours() + 8) % 24
  if (q.start === q.end) return false
  return q.start < q.end ? (twHour >= q.start && twHour < q.end) : (twHour >= q.start || twHour < q.end)
}
