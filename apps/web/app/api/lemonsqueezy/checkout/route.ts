export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { createCheckout } from '@lemonsqueezy/lemonsqueezy.js'
import '@/lib/lemonsqueezy'
import { LS_STORE_ID, LS_PRO_VARIANT_ID } from '@/lib/lemonsqueezy'

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

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const userRecord = await adminAuth.getUser(uid)

  const { data, error } = await createCheckout(LS_STORE_ID, LS_PRO_VARIANT_ID, {
    checkoutOptions: {
      embed: false,
      media: false,
    },
    checkoutData: {
      email: userRecord.email ?? undefined,
      custom: { uid },
    },
    productOptions: {
      redirectUrl: `${origin}/dashboard/settings?upgraded=1`,
      receiptButtonText: '返回設定',
      receiptThankYouNote: '感謝升級 Pro！每月額度已更新。',
    },
  })

  if (error || !data?.data?.attributes?.url) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create checkout' }, { status: 500 })
  }

  return NextResponse.json({ url: data.data.attributes.url })
}
