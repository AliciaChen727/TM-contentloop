export const dynamic = 'force-dynamic'
export const maxDuration = 30
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { canvaFetch } from '@/lib/canva/client'

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { designId: string } },
) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { designId } = params

  let designRes: Response, pagesRes: Response
  try {
    [designRes, pagesRes] = await Promise.all([
      canvaFetch(uid, `/designs/${designId}`),
      canvaFetch(uid, `/designs/${designId}/pages`),
    ])
  } catch (e) {
    // getValidAccessToken throws when there's no stored token or refresh failed.
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[canva/design] token error for uid=${uid}: ${msg}`)
    return NextResponse.json({ error: 'CANVA_NOT_CONNECTED', detail: msg }, { status: 401 })
  }

  if (!designRes.ok) {
    const detail = await designRes.text().catch(() => '')
    console.error(`[canva/design] designId=${designId} canva status=${designRes.status} body=${detail.slice(0, 300)}`)
    if (designRes.status === 401 || designRes.status === 403) {
      // 401/403 here means this design isn't owned by / accessible to the connected account.
      return NextResponse.json({ error: 'CANVA_DESIGN_FORBIDDEN', canvaStatus: designRes.status }, { status: 403 })
    }
    return NextResponse.json({ error: 'Design not found', canvaStatus: designRes.status }, { status: 404 })
  }

  const { design } = await designRes.json()
  const editUrl = `https://www.canva.com/design/${designId}/edit`

  // Canva's API does NOT expose a design's text/element content — only a
  // thumbnail image. The Get Design response carries design.thumbnail.url
  // directly; fall back to the first page's thumbnail. We send the image to the
  // AI for visual analysis (it reads the text from the image itself).
  let thumbUrl: string | undefined = design?.thumbnail?.url
  if (!thumbUrl && pagesRes.ok) {
    try {
      const { pages } = await pagesRes.json()
      thumbUrl = pages?.[0]?.thumbnail?.url
    } catch { /* ignore */ }
  }

  let thumbnail: { data: string; mimeType: string } | null = null
  if (thumbUrl) {
    try {
      const imgRes = await fetch(thumbUrl)
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer())
        thumbnail = {
          data: buf.toString('base64'),
          mimeType: imgRes.headers.get('content-type') ?? 'image/png',
        }
      } else {
        console.error(`[canva/design] thumbnail download failed status=${imgRes.status}`)
      }
    } catch (e) {
      console.error(`[canva/design] thumbnail fetch error: ${e instanceof Error ? e.message : e}`)
    }
  } else {
    console.error(`[canva/design] no thumbnail url for designId=${designId}`)
  }

  return NextResponse.json({ title: design.title ?? '', editUrl, thumbnail })
}
