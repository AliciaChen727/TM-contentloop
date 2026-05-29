export const dynamic = 'force-dynamic'
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

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, name } = await req.json()
  if (!url || !name) return NextResponse.json({ error: 'Missing url or name' }, { status: 400 })

  // Create URL asset upload job
  const createRes = await canvaFetch(uid, '/url-asset-uploads', {
    method: 'POST',
    body: JSON.stringify({ url, name }),
  })

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    if (err?.code === 'CANVA_NOT_CONNECTED' || createRes.status === 401) {
      return NextResponse.json({ error: 'CANVA_NOT_CONNECTED' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Upload job creation failed' }, { status: 502 })
  }

  const { job } = await createRes.json()
  const jobId: string = job.id

  // Poll until complete (max 30s)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await canvaFetch(uid, `/url-asset-uploads/${jobId}`)
    if (!pollRes.ok) continue
    const { job: j } = await pollRes.json()
    if (j.status === 'success') {
      return NextResponse.json({ assetId: j.asset?.id, assetUrl: url })
    }
    if (j.status === 'failed') {
      return NextResponse.json({ error: 'Asset upload failed' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Upload timed out' }, { status: 504 })
}
