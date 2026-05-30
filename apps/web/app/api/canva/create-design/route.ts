export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { canvaFetch } from '@/lib/canva/client'

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    return (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return null
  }
}

// Push an AI-generated image into Canva as a new design:
//   1. Upload the image bytes as a Canva asset (binary asset-uploads, async job)
//   2. Create a new design containing that asset
//   3. Return the design's edit URL
// Canva's API can't inject editable text, so the Chinese copy stays as
// copy-to-clipboard text in the UI for the user to paste in Canva.
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imageData, title } = await req.json() as {
    imageData?: string; mimeType?: string; title?: string
  }
  if (!imageData) return NextResponse.json({ error: 'Missing imageData' }, { status: 400 })

  const buf = Buffer.from(imageData, 'base64')
  const name = (title || 'ContentLoop AI 設計').slice(0, 50)
  const nameB64 = Buffer.from(name).toString('base64')

  // 1. Binary asset upload (async job)
  let createRes: Response
  try {
    createRes = await canvaFetch(uid, '/asset-uploads', {
      method: 'POST',
      headers: {
        // Canva's binary asset upload requires octet-stream, NOT the image mime
        // type (image/png → 415 Unsupported Media Type).
        'Content-Type': 'application/octet-stream',
        'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameB64 }),
      },
      body: buf,
    })
  } catch (e) {
    console.error('[canva/create-design] token error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'CANVA_NOT_CONNECTED' }, { status: 401 })
  }

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '')
    console.error(`[canva/create-design] asset upload failed status=${createRes.status} body=${detail.slice(0, 300)}`)
    if (createRes.status === 401 || createRes.status === 403) {
      return NextResponse.json({ error: 'CANVA_NOT_CONNECTED' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Asset upload failed' }, { status: 502 })
  }

  const jobId: string | undefined = (await createRes.json()).job?.id
  if (!jobId) return NextResponse.json({ error: 'No upload job id' }, { status: 502 })

  // 2. Poll until the asset is ready (max ~30s)
  let assetId: string | undefined
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await canvaFetch(uid, `/asset-uploads/${jobId}`)
    if (!pollRes.ok) continue
    const { job } = await pollRes.json()
    if (job?.status === 'success') { assetId = job.asset?.id; break }
    if (job?.status === 'failed') {
      console.error('[canva/create-design] asset job failed:', JSON.stringify(job).slice(0, 300))
      return NextResponse.json({ error: 'Asset upload failed' }, { status: 502 })
    }
  }
  if (!assetId) return NextResponse.json({ error: 'Asset upload timed out' }, { status: 504 })

  // 3. Create a design containing the asset
  const designRes = await canvaFetch(uid, '/designs', {
    method: 'POST',
    body: JSON.stringify({
      type: 'type_and_asset',
      design_type: { type: 'preset', name: 'instagram_post' },
      asset_id: assetId,
      title: name,
    }),
  })

  if (!designRes.ok) {
    const detail = await designRes.text().catch(() => '')
    console.error(`[canva/create-design] create design failed status=${designRes.status} body=${detail.slice(0, 300)}`)
    return NextResponse.json({ error: 'Create design failed' }, { status: 502 })
  }

  const { design } = await designRes.json()
  const editUrl: string = design?.urls?.edit_url ?? `https://www.canva.com/design/${design?.id}/edit`
  return NextResponse.json({ editUrl, designId: design?.id })
}
