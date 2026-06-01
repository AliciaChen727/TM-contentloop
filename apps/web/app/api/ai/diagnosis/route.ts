export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import type { DiagItem } from '@/components/ads/types'
import { computeDiagFingerprint, selectItemsForAgent } from '@/lib/ads/diagnosisAgent'
import { getOrGenerateDiagnosisCards } from '@/lib/ads/diagnosisAgentServer'

// Does this uid have read access to pageId? Mirrors api/ads/data: owner (own
// snapshot), admin, viewer (with ads permission), or super-admin.
async function canAccessPage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('pages').doc(pageId).collection('adInsights').doc('latest').get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  if (admin.exists) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const pages: { pageId: string; permissions?: { ads?: boolean } }[] = viewer.data()?.pages ?? []
  return pages.some((p) => p.pageId === pageId && p.permissions?.ads)
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { pageId, items, summary } = (await req.json()) as {
    pageId?: string; items?: DiagItem[]; summary?: Record<string, number>
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canAccessPage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const allItems = Array.isArray(items) ? items : []
  const selected = selectItemsForAgent(allItems)
  if (selected.length === 0) return NextResponse.json({ cards: [], fingerprint: null })

  const anthropicKey = (await getUserApiKey(uid, 'anthropic')) ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })

  const cards = await getOrGenerateDiagnosisCards(pageId, allItems, summary ?? {}, anthropicKey)
  if (!cards) return NextResponse.json({ error: 'AI 回應格式異常', fallback: true }, { status: 200 })

  return NextResponse.json({ cards, fingerprint: computeDiagFingerprint(allItems) })
}
