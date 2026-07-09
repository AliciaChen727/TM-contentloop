export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

async function verifySuperAdmin(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch { return null }

  if (isSuperAdmin(uid)) return uid
  return null
}

export async function GET(req: NextRequest) {
  const uid = await verifySuperAdmin(req)
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
      const claudeInputTokens: number = usage?.claudeInputTokens ?? 0
      const claudeOutputTokens: number = usage?.claudeOutputTokens ?? 0
      const claudeCostUsd: number = usage?.claudeCostUsd ?? 0
      const totalCostUsd = imageCostUsd + videoCostUsd + claudeCostUsd

      if (imageCount === 0 && videoSeconds === 0 && claudeInputTokens === 0) return null

      let email = userId
      let displayName = ''
      try {
        const userRecord = await adminAuth.getUser(userId)
        email = userRecord.email ?? userId
        displayName = userRecord.displayName ?? ''
      } catch { /* user might not exist in Auth */ }

      return { uid: userId, email, displayName, imageCount, imageCostUsd, videoCount, videoSeconds, videoCostUsd, claudeInputTokens, claudeOutputTokens, claudeCostUsd, totalCostUsd }
    })
  )

  const filtered = results
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)

  return NextResponse.json({ month, rows: filtered })
}
