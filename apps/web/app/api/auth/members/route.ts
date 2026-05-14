export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

interface Permissions { home: boolean; ads: boolean; sidekick: boolean; syncAds: boolean }

async function verifyAdmin(idToken: string, pageId: string): Promise<string | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    const uid = decoded.uid
    const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
    const adminPageIds = new Set(
      tokensSnap.docs.filter(d => d.id !== 'userToken').map(d => d.id === 'page' ? d.data().pageId : d.id).filter(Boolean)
    )
    return adminPageIds.has(pageId) ? uid : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })

  const uid = await verifyAdmin(idToken, pageId)
  if (!uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await adminDb.collection('pages').doc(pageId).collection('members').get()
  const members = snap.docs
    .filter(d => d.id !== uid)
    .map(d => {
      const data = d.data()
      return {
        uid: d.id,
        email: data.email ?? '',
        permissions: data.permissions ?? { home: true, ads: true, sidekick: true, syncAds: false },
        addedAt: data.addedAt?.toDate?.()?.toISOString() ?? null,
      }
    })

  return NextResponse.json({ members })
}

export async function PATCH(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  const targetUid = req.nextUrl.searchParams.get('uid')
  if (!pageId || !targetUid) return NextResponse.json({ error: 'Missing pageId or uid' }, { status: 400 })

  const adminUid = await verifyAdmin(idToken, pageId)
  if (!adminUid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { permissions }: { permissions: Permissions } = await req.json()

  // Update pages/{pageId}/members/{uid}
  await adminDb.collection('pages').doc(pageId).collection('members').doc(targetUid).update({ permissions })

  // Update users/{uid}/viewerAccess/pages — update permissions for this specific page
  const viewerRef = adminDb.collection('users').doc(targetUid).collection('viewerAccess').doc('pages')
  const viewerSnap = await viewerRef.get()
  if (viewerSnap.exists) {
    const pages: { pageId: string; permissions?: Permissions }[] = viewerSnap.data()?.pages ?? []
    const updated = pages.map(p => p.pageId === pageId ? { ...p, permissions } : p)
    await viewerRef.update({ pages: updated })
  }

  return NextResponse.json({ success: true })
}
