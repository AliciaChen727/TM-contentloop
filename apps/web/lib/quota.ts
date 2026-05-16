import { adminDb } from '@/lib/firebase/admin'
import { currentMonth } from '@/lib/usage'

export type Tier = 'free' | 'pro'

export const QUOTAS: Record<Tier, { imageCount: number; videoSeconds: number }> = {
  free: { imageCount: 10, videoSeconds: 5 },
  pro:  { imageCount: 100, videoSeconds: 30 },
}

export interface SubscriptionDoc {
  tier: Tier
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  currentPeriodEnd?: FirebaseFirestore.Timestamp
}

export async function getTier(uid: string): Promise<Tier> {
  const doc = await adminDb.collection('users').doc(uid).collection('subscription').doc('current').get()
  if (!doc.exists) return 'free'
  const data = doc.data() as SubscriptionDoc
  if (data.tier === 'pro' && data.currentPeriodEnd && data.currentPeriodEnd.toDate() > new Date()) return 'pro'
  return 'free'
}

export async function checkImageQuota(uid: string): Promise<{ ok: boolean; tier: Tier; used: number; limit: number }> {
  const [tier, usageDoc] = await Promise.all([
    getTier(uid),
    adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).get(),
  ])
  const used: number = usageDoc.data()?.imageCount ?? 0
  const limit = QUOTAS[tier].imageCount
  return { ok: used < limit, tier, used, limit }
}

export async function checkVideoQuota(uid: string, requestedSeconds: number): Promise<{ ok: boolean; tier: Tier; usedSeconds: number; limit: number }> {
  const [tier, usageDoc] = await Promise.all([
    getTier(uid),
    adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).get(),
  ])
  const usedSeconds: number = usageDoc.data()?.videoSeconds ?? 0
  const limit = QUOTAS[tier].videoSeconds
  return { ok: usedSeconds + requestedSeconds <= limit, tier, usedSeconds, limit }
}
