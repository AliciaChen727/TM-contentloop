export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, listAllPages } from '@/lib/auth/superadmin'

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

  // Super-admin: authorized for every page in the system.
  if (isSuperAdmin(uid)) {
    const all = await listAllPages()
    return NextResponse.json({ authorized: true, authorizedPageIds: all.map(p => p.pageId) })
  }

  const authorizedPageIds: string[] = []

  // --- Path 1: owner / admin (connected Meta) ---
  const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const pageIds = tokensSnap.docs
    .filter(d => d.id !== 'userToken' && d.id !== 'page')
    .map(d => d.id)

  // Fallback: try legacy 'page' doc
  if (pageIds.length === 0) {
    const oldDoc = tokensSnap.docs.find(d => d.id === 'page')
    if (oldDoc) pageIds.push(oldDoc.data().pageId ?? 'page')
  }

  for (const pageId of pageIds) {
    const adminDoc = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
    if (adminDoc.exists) {
      // Any entry in admins collection (owner or non-owner) is authorized
      authorizedPageIds.push(pageId)
      continue
    }
    // Legacy fallback: no admins doc yet — authorize whoever connected first
    const ownerSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
      .where('isOwner', '==', true).limit(1).get()
    if (ownerSnap.empty) {
      const earliestSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
        .orderBy('addedAt', 'asc').limit(1).get()
      if (!earliestSnap.empty && earliestSnap.docs[0].id === uid) {
        authorizedPageIds.push(pageId)
      }
    }
  }

  // --- Path 2: invited viewer (accepted invite, no Meta connection needed) ---
  const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  const viewerPageIds: string[] = viewerSnap.exists ? (viewerSnap.data()?.pages ?? []) : []
  for (const pageId of viewerPageIds) {
    if (!authorizedPageIds.includes(pageId)) authorizedPageIds.push(pageId)
  }

  return NextResponse.json({ authorized: authorizedPageIds.length > 0, authorizedPageIds })
}
