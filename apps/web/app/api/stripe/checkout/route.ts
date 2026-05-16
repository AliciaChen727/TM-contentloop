export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import stripe from '@/lib/stripe'

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const priceId = process.env.STRIPE_PRO_PRICE_ID
  if (!priceId) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // Find or create Stripe customer
  const subDoc = await adminDb.collection('users').doc(uid).collection('subscription').doc('current').get()
  let customerId: string | undefined = subDoc.data()?.stripeCustomerId

  if (!customerId) {
    const userRecord = await adminAuth.getUser(uid)
    const customer = await stripe.customers.create({
      email: userRecord.email,
      metadata: { uid },
    })
    customerId = customer.id
    await adminDb.collection('users').doc(uid).collection('subscription').doc('current').set(
      { stripeCustomerId: customerId },
      { merge: true }
    )
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/settings?upgraded=1`,
    cancel_url: `${origin}/dashboard/settings`,
    metadata: { uid },
    subscription_data: { metadata: { uid } },
  })

  return NextResponse.json({ url: session.url })
}
