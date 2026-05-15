export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ authorized: false }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ authorized: false }, { status: 401 })
  }

  const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const pageIds = tokensSnap.docs
    .filter(d => d.id !== 'userToken' && d.id !== 'page')
    .map(d => d.id)

  // Fallback: try legacy 'page' doc
  if (pageIds.length === 0) {
    const oldDoc = tokensSnap.docs.find(d => d.id === 'page')
    if (oldDoc) pageIds.push(oldDoc.data().pageId ?? 'page')
  }

  if (pageIds.length === 0) return NextResponse.json({ authorized: false })

  const authorizedPageIds: string[] = []

  for (const pageId of pageIds) {
    // Check if this user is an explicit owner
    const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
    if (adminDoc.exists && adminDoc.data()?.isOwner === true) {
      authorizedPageIds.push(pageId)
      continue
    }

    // Legacy fallback: if no one has isOwner yet, authorize whoever connected first
    const ownerSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
      .where('isOwner', '==', true).limit(1).get()
    if (ownerSnap.empty) {
      // No owner set yet — check if this user is the earliest admin by addedAt
      const earliestSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
        .orderBy('addedAt', 'asc').limit(1).get()
      if (!earliestSnap.empty && earliestSnap.docs[0].id === uid) {
        authorizedPageIds.push(pageId)
      }
    }
  }

  return NextResponse.json({ authorized: authorizedPageIds.length > 0, authorizedPageIds })
}
