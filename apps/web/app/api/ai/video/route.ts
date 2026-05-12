export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

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

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, durationSeconds } = await req.json() as { prompt: string; durationSeconds?: number }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })

  const duration = Math.min(Math.max(1, Math.round(durationSeconds ?? 5)), 8)

  const veoRes = await fetch(
    `${BASE}/models/veo-2.0-generate-001:predictLongRunning?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: '9:16', durationSeconds: duration },
      }),
    }
  )

  const data = await veoRes.json()
  if (!veoRes.ok || data.error) {
    return NextResponse.json({ error: data.error?.message ?? 'Veo request failed' }, { status: 500 })
  }

  return NextResponse.json({ operationName: data.name })
}

export async function GET(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const op = req.nextUrl.searchParams.get('op')
  if (!op) return NextResponse.json({ error: 'Missing op parameter' }, { status: 400 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })

  const opRes = await fetch(`${BASE}/${op}?key=${apiKey}`)
  const data = await opRes.json()

  if (!opRes.ok || data.error) {
    return NextResponse.json({ error: data.error?.message ?? 'Operation check failed' }, { status: 500 })
  }

  if (!data.done) return NextResponse.json({ done: false })

  const samples = data.response?.generateVideoResponse?.generatedSamples
  const videoUri: string | undefined = samples?.[0]?.video?.uri
  if (!videoUri) return NextResponse.json({ error: 'No video in response' }, { status: 500 })

  if (!videoUri.startsWith('https://')) {
    return NextResponse.json({ error: 'Video is in GCS — configure a GCS bucket to enable downloads' }, { status: 500 })
  }

  const videoRes = await fetch(`${videoUri}?key=${apiKey}`)
  if (!videoRes.ok) return NextResponse.json({ error: 'Failed to download video' }, { status: 500 })

  const buf = await videoRes.arrayBuffer()
  const videoData = Buffer.from(buf).toString('base64')
  const mimeType = videoRes.headers.get('content-type') || 'video/mp4'

  return NextResponse.json({ done: true, videoData, mimeType })
}
