export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

type Language = 'zh-TW' | 'en'

interface OrganizationContext {
  name: string
  type: string
  coreKpi: string
  extraContext: string
}

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const data = snap.data()
  const language: Language = data?.language ?? 'zh-TW'
  const organizationContext: OrganizationContext | null = data?.organizationContext ?? null
  return NextResponse.json({ language, organizationContext })
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: { language?: Language; organizationContext?: OrganizationContext | null } = await req.json()
  const { language, organizationContext } = body

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (language !== undefined) {
    if (language !== 'zh-TW' && language !== 'en') {
      return NextResponse.json({ error: 'Invalid language' }, { status: 400 })
    }
    update.language = language
  }
  if (organizationContext !== undefined) {
    update.organizationContext = organizationContext ?? FieldValue.delete()
  }

  await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').set(
    update,
    { merge: true }
  )

  return NextResponse.json({ success: true })
}
