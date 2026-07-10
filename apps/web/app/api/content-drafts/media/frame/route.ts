/**
 * Extract a video frame as the FB cover image (dev-mode fallback: FB videos
 * are invisible to non-app-role viewers, so FB publishes this image instead
 * while IG/Threads still get the video). BFF: Bearer + content.draft.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { extractVideoFrame } from '@/lib/media/composeAudio'

const ALLOWED_HOST = 'https://firebasestorage.googleapis.com/'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

// POST { pageId, videoUrl, atSeconds }
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId, videoUrl, atSeconds } = (await req.json().catch(() => ({}))) as {
    pageId?: string; videoUrl?: string; atSeconds?: number
  }
  if (!pageId || !videoUrl || typeof atSeconds !== 'number') {
    return NextResponse.json({ error: 'pageId, videoUrl, atSeconds required' }, { status: 400 })
  }
  if (!videoUrl.startsWith(ALLOWED_HOST)) {
    return NextResponse.json({ error: '影片需先上傳到 ContentLoop' }, { status: 400 })
  }
  if (!(await can(uid, pageId, 'content.draft'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const imageUrl = await extractVideoFrame(pageId, videoUrl, atSeconds)
    return NextResponse.json({ ok: true, imageUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'frame extract failed'
    return NextResponse.json({ error: `封面截圖失敗：${msg}` }, { status: 502 })
  }
}
