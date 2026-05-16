export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

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
  const portalUrl: string | null = subDoc.data()?.customerPortalUrl ?? null

  // Fallback to LemonSqueezy general account page if portal URL not stored yet
  const url = portalUrl ?? 'https://app.lemonsqueezy.com/my-orders'

  return NextResponse.json({ url })
}
