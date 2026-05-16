export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { currentMonth } from '@/lib/usage'
import { getTier, QUOTAS } from '@/lib/quota'

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [tier, usageDoc] = await Promise.all([
    getTier(uid),
    adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).get(),
  ])

  const usage = usageDoc.data() ?? {}
  const quotas = QUOTAS[tier]

  return NextResponse.json({
    tier,
    imageCount: usage.imageCount ?? 0,
    imageCostUsd: usage.imageCostUsd ?? 0,
    videoCount: usage.videoCount ?? 0,
    videoSeconds: usage.videoSeconds ?? 0,
    videoCostUsd: usage.videoCostUsd ?? 0,
    imageLimit: quotas.imageCount,
    videoSecondsLimit: quotas.videoSeconds,
  })
}
