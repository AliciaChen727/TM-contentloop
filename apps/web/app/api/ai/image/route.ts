export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { GoogleAuth } from 'google-auth-library'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await adminAuth.verifyIdToken(idToken)
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { prompt } = await req.json() as { prompt: string }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    return NextResponse.json({ error: 'GCP Service Account not configured' }, { status: 500 })
  }

  try {
    const auth = new GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const token = await auth.getAccessToken()
    const projectId = clientEmail.split('@')[1].split('.')[0]
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/imagen-3.0-fast-generate-001:predict`

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Image generation failed' }, { status: 500 })
    }
    const b64 = data.predictions?.[0]?.bytesBase64Encoded
    const mime = data.predictions?.[0]?.mimeType ?? 'image/jpeg'
    if (!b64) return NextResponse.json({ error: 'No image in response' }, { status: 500 })
    return NextResponse.json({ imageData: b64, mimeType: mime })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal server error' }, { status: 500 })
  }
}
