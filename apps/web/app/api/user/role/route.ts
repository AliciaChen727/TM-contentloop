export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ isOwner: false, isAdmin: false })

  const adminSnap = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  const isAdmin = adminSnap.exists
  const isOwner = isAdmin // in current schema, being in admins collection = owner-level access

  return NextResponse.json({ isOwner, isAdmin })
}
