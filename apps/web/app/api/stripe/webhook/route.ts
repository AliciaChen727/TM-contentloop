export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import stripe from '@/lib/stripe'
import Stripe from 'stripe'
import { FieldValue } from 'firebase-admin/firestore'

async function writeSubscription(uid: string, data: Record<string, unknown>) {
  await adminDb.collection('users').doc(uid).collection('subscription').doc('current').set(data, { merge: true })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !secret) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const uid = session.metadata?.uid
      if (!uid || !session.subscription) return NextResponse.json({ received: true })

      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      await writeSubscription(uid, {
        tier: 'pro',
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription
      const uid = sub.metadata?.uid
      if (!uid) return NextResponse.json({ received: true })

      const isActive = sub.status === 'active' || sub.status === 'trialing'
      await writeSubscription(uid, {
        tier: isActive ? 'pro' : 'free',
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      const uid = sub.metadata?.uid
      if (!uid) return NextResponse.json({ received: true })

      await writeSubscription(uid, {
        tier: 'free',
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  } catch (e) {
    console.error('Webhook handler error:', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
