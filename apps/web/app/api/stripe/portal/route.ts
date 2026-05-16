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

  const subDoc = await adminDb.collection('users').doc(uid).collection('subscription').doc('current').get()
  const customerId = subDoc.data()?.stripeCustomerId
  if (!customerId) return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 })

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard/settings`,
  })

  return NextResponse.json({ url: session.url })
}
