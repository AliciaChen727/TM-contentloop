export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { GoogleAuth } from 'google-auth-library'
import { recordVideoGeneration } from '@/lib/usage'
import { checkVideoQuota } from '@/lib/quota'

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

function getAuthAndProject() {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('GCP Service Account not configured')
  const projectId = clientEmail.split('@')[1].split('.')[0]
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  return { auth, projectId }
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { prompt, durationSeconds } = await req.json() as { prompt: string; durationSeconds?: number }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })
  const duration = Math.min(Math.max(5, Math.round(durationSeconds ?? 5)), 8)

  const quota = await checkVideoQuota(uid, duration)
  if (!quota.ok) {
    return NextResponse.json(
      { error: `本月影片額度已用盡（已用 ${quota.usedSeconds}/${quota.limit} 秒）。升級 Pro 方案可獲得更多額度。` },
      { status: 429 }
    )
  }

  try {
    const { auth, projectId } = getAuthAndProject()
    const token = await auth.getAccessToken()
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-2.0-generate-001:predictLongRunning`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio: '9:16',
          durationSeconds: duration,
          sampleCount: 1,
          personGeneration: 'allow_adult',
        },
      }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Veo request failed' }, { status: 500 })
    }
    await recordVideoGeneration(uid, duration)
    return NextResponse.json({ operationName: data.name })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const opName = req.nextUrl.searchParams.get('op')
  if (!opName) return NextResponse.json({ error: 'Missing op parameter' }, { status: 400 })

  try {
    const { auth, projectId } = getAuthAndProject()
    const token = await auth.getAccessToken()
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-2.0-generate-001:fetchPredictOperation`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: opName }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Operation check failed' }, { status: 500 })
    }
    if (!data.done) return NextResponse.json({ done: false })
    const video = data.response?.videos?.[0]
    const b64 = video?.bytesBase64Encoded
    const mime = video?.mimeType ?? 'video/mp4'
    if (!b64) return NextResponse.json({ error: 'No video in response' }, { status: 500 })
    return NextResponse.json({ done: true, videoData: b64, mimeType: mime })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500 })
  }
}
