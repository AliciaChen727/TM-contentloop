export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

// Disconnect the user's Canva account by deleting the stored tokens. Used by the
// "switch account" flow: after this, reconnecting lets the user pick a different
// Canva account on Canva's consent screen.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  await adminDb
    .collection('users').doc(uid)
    .collection('integrations').doc('canva')
    .delete()

  return NextResponse.json({ success: true })
}
