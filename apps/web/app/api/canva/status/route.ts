export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { getCanvaTokens } from '@/lib/canva/client'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    const tokens = await getCanvaTokens(decoded.uid)
    return NextResponse.json({ connected: !!tokens })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
