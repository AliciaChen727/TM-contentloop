/**
 * Compose music into draft media (Slice 1). Editing-time operation: the
 * composed video becomes the draft's media, so preview = what gets published
 * and the publish pipeline stays untouched. BFF: Bearer + content.draft.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // ffmpeg on a full-length draft video needs headroom

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { composeImageAudio, composeVideoAudio } from '@/lib/media/composeAudio'

const ALLOWED_HOST = 'https://firebasestorage.googleapis.com/'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

// POST { pageId, mediaUrl, audioUrl, kind: 'image' | 'video' }
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId, mediaUrl, audioUrl, kind } = (await req.json().catch(() => ({}))) as {
    pageId?: string; mediaUrl?: string; audioUrl?: string; kind?: string
  }
  if (!pageId || !mediaUrl || !audioUrl || (kind !== 'image' && kind !== 'video')) {
    return NextResponse.json({ error: 'pageId, mediaUrl, audioUrl, kind required' }, { status: 400 })
  }
  // 只吃自家 Storage 的 URL：避免這支端點被拿去抓任意外部資源（SSRF）。
  if (!mediaUrl.startsWith(ALLOWED_HOST) || !audioUrl.startsWith(ALLOWED_HOST)) {
    return NextResponse.json({ error: '媒體與音訊需先上傳到 ContentLoop' }, { status: 400 })
  }
  if (!(await can(uid, pageId, 'content.draft'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const videoUrl = kind === 'image'
      ? await composeImageAudio(pageId, mediaUrl, audioUrl)
      : await composeVideoAudio(pageId, mediaUrl, audioUrl)
    return NextResponse.json({ ok: true, videoUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'compose failed'
    return NextResponse.json({ error: `音樂合成失敗：${msg}` }, { status: 502 })
  }
}
