export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

async function verifyOwner(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch { return null }

  const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  for (const tokenDoc of tokensSnap.docs) {
    if (tokenDoc.id === 'userToken' || tokenDoc.id === 'page') continue
    const pageId = tokenDoc.id
    const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
    if (adminDoc.data()?.isOwner === true) return uid
  }
  return null
}

export async function GET(req: NextRequest) {
  const uid = await verifyOwner(req)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)

  // Use collectionGroup so we find usage docs even when users/{uid} parent doc has no fields
  const usageSnap = await adminDb.collectionGroup('usage').get()
  const monthDocs = usageSnap.docs.filter(d => d.id === month)

  const results = await Promise.all(
    monthDocs.map(async (usageDoc) => {
      const userId = usageDoc.ref.parent.parent!.id
      const usage = usageDoc.data()

      const imageCount: number = usage?.imageCount ?? 0
      const imageCostUsd: number = usage?.imageCostUsd ?? 0
      const videoCount: number = usage?.videoCount ?? 0
      const videoSeconds: number = usage?.videoSeconds ?? 0
      const videoCostUsd: number = usage?.videoCostUsd ?? 0
      const totalCostUsd = imageCostUsd + videoCostUsd

      if (imageCount === 0 && videoSeconds === 0) return null

      let email = userId
      let displayName = ''
      try {
        const userRecord = await adminAuth.getUser(userId)
        email = userRecord.email ?? userId
        displayName = userRecord.displayName ?? ''
      } catch { /* user might not exist in Auth */ }

      return { uid: userId, email, displayName, imageCount, imageCostUsd, videoCount, videoSeconds, videoCostUsd, totalCostUsd }
    })
  )

  const filtered = results
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)

  return NextResponse.json({ month, rows: filtered })
}
