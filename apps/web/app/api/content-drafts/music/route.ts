/**
 * Per-page royalty-free music library (Slice 2). Tracks live in
 * pages/{pageId}/musicTracks; the audio files themselves sit in Firebase
 * Storage (uploaded via the existing uploads/{uid} client path). Meta's
 * licensed music catalog is NOT available via API, so pages curate their own
 * royalty-free tracks once and reuse them across drafts.
 * BFF: Bearer + content.draft (read/add), content.publish (delete).
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'

const ALLOWED_HOST = 'https://firebasestorage.googleapis.com/'
const MAX_TRACKS = 100

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

const col = (pageId: string) => adminDb.collection('pages').doc(pageId).collection('musicTracks')

// GET ?pageId= → { tracks: [{ id, name, url, createdAt }] }（新→舊）
export async function GET(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await can(uid, pageId, 'content.draft'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const snap = await col(pageId).orderBy('createdAt', 'desc').limit(MAX_TRACKS).get()
  const tracks = snap.docs.map(d => ({ id: d.id, name: d.data().name ?? '', url: d.data().url ?? '', createdAt: d.data().createdAt ?? 0 }))
  return NextResponse.json({ tracks })
}

// POST { pageId, name, url } → 新增曲目（url 需為已上傳到 ContentLoop 的音檔）
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, name, url } = (await req.json().catch(() => ({}))) as { pageId?: string; name?: string; url?: string }
  if (!pageId || !name?.trim() || !url) return NextResponse.json({ error: 'pageId, name, url required' }, { status: 400 })
  if (!url.startsWith(ALLOWED_HOST)) return NextResponse.json({ error: '音檔需先上傳到 ContentLoop' }, { status: 400 })
  if (!(await can(uid, pageId, 'content.draft'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = await col(pageId).add({ name: name.trim().slice(0, 80), url, createdAt: Date.now(), byUid: uid })
  return NextResponse.json({ ok: true, id: ref.id })
}

// DELETE { pageId, id } → 從曲庫移除（僅 admin；Storage 檔案保留，已合成的草稿不受影響）
export async function DELETE(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, id } = (await req.json().catch(() => ({}))) as { pageId?: string; id?: string }
  if (!pageId || !id) return NextResponse.json({ error: 'pageId, id required' }, { status: 400 })
  if (!(await can(uid, pageId, 'content.publish'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await col(pageId).doc(id).delete()
  return NextResponse.json({ ok: true })
}
