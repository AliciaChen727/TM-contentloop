/**
 * Brand asset library (per page). Stores brand images (logo, etc.) the user
 * uploads, with a keyword tag. The file lives in Firebase Storage (uploaded
 * client-side → public URL); this stores the metadata. Used to bring brand
 * assets into Canva (the user overlays them on a generated design).
 *
 * GET  ?pageId=           → list (admin / viewer / super-admin)
 * POST { pageId, name, keyword, url, mimeType }  → add (admin only)
 * DELETE { pageId, id }   → remove (admin only)
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'

async function uidFrom(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}
async function isAdmin(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  if ((await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()).exists) return true
  return (await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()).exists
}
async function canRead(uid: string, pageId: string): Promise<boolean> {
  if (await isAdmin(uid, pageId)) return true
  const viewer = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
  return ((viewer.data()?.pages ?? []) as { pageId: string }[]).some(p => p.pageId === pageId)
}
const col = (pageId: string) => adminDb.collection('pages').doc(pageId).collection('brandAssets')

export async function GET(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })
  if (!(await canRead(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const snap = await col(pageId).orderBy('createdAt', 'desc').get()
  return NextResponse.json({ assets: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
}

export async function POST(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const { pageId, name, keyword, url, mimeType } = b as { pageId?: string; name?: string; keyword?: string; url?: string; mimeType?: string }
  if (!pageId || !name || !url) return NextResponse.json({ error: 'pageId, name, url required' }, { status: 400 })
  if (!(await isAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ref = await col(pageId).add({
    name: name.slice(0, 80),
    keyword: (keyword ?? '').slice(0, 60),
    url, mimeType: mimeType ?? 'image/png',
    byUid: uid, createdAt: new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, id: ref.id })
}

export async function DELETE(req: NextRequest) {
  const uid = await uidFrom(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, id } = (await req.json().catch(() => ({}))) as { pageId?: string; id?: string }
  if (!pageId || !id) return NextResponse.json({ error: 'pageId, id required' }, { status: 400 })
  if (!(await isAdmin(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await col(pageId).doc(id).delete()
  return NextResponse.json({ ok: true })
}
