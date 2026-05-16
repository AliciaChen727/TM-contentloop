export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { LS_WEBHOOK_SECRET } from '@/lib/lemonsqueezy'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac } from 'crypto'

async function writeSubscription(uid: string, data: Record<string, unknown>) {
  await adminDb.collection('users').doc(uid).collection('subscription').doc('current').set(data, { merge: true })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-signature')

  if (!signature || !LS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const hash = createHmac('sha256', LS_WEBHOOK_SECRET).update(body).digest('hex')
  if (hash !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const payload = JSON.parse(body)
  const eventName: string = payload.meta?.event_name
  const uid: string | undefined = payload.meta?.custom_data?.uid
  const attrs = payload.data?.attributes

  if (!uid) return NextResponse.json({ received: true })

  try {
    if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
      const isActive = attrs?.status === 'active' || attrs?.status === 'on_trial'
      await writeSubscription(uid, {
        tier: isActive ? 'pro' : 'free',
        lsSubscriptionId: payload.data?.id,
        lsCustomerId: String(attrs?.customer_id ?? ''),
        currentPeriodEnd: attrs?.renews_at ? new Date(attrs.renews_at) : null,
        customerPortalUrl: attrs?.urls?.customer_portal ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
      await writeSubscription(uid, {
        tier: 'free',
        lsSubscriptionId: null,
        currentPeriodEnd: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  } catch (e) {
    console.error('LemonSqueezy webhook error:', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
