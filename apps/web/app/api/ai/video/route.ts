export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { adminAuth } from '@/lib/firebase/admin'

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

function getAi() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini API not configured')
  return new GoogleGenAI({ apiKey })
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, durationSeconds } = await req.json() as { prompt: string; durationSeconds?: number }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })

  const duration = Math.min(Math.max(1, Math.round(durationSeconds ?? 5)), 8)

  let ai: GoogleGenAI
  try { ai = getAi() } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }

  try {
    const operation = await ai.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      source: { prompt },
      config: {
        numberOfVideos: 1,
        aspectRatio: '9:16',
        resolution: '720p',
        personGeneration: 'allow_adult',
        durationSeconds: duration,
      },
    })
    return NextResponse.json({ operationName: operation.name })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Veo request failed: ' + msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const uid = await verifyAuth(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const opName = req.nextUrl.searchParams.get('op')
  if (!opName) return NextResponse.json({ error: 'Missing op parameter' }, { status: 400 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })

  try {
    // Poll via REST — SDK requires the full operation object which we can't reconstruct from name alone
    const opRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`)
    const data = await opRes.json()

    if (!opRes.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Operation check failed' }, { status: 500 })
    }

    if (!data.done) return NextResponse.json({ done: false })

    const videoUri: string | undefined = data.response?.generatedVideos?.[0]?.video?.uri
    if (!videoUri) return NextResponse.json({ error: 'No video in response' }, { status: 500 })

    // URI already contains query params — append key with &
    const videoRes = await fetch(`${videoUri}&key=${apiKey}`)
    if (!videoRes.ok) return NextResponse.json({ error: 'Failed to download video' }, { status: 500 })

    const buf = await videoRes.arrayBuffer()
    const videoData = Buffer.from(buf).toString('base64')
    const mimeType = videoRes.headers.get('content-type') || 'video/mp4'

    return NextResponse.json({ done: true, videoData, mimeType })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Operation check failed: ' + msg }, { status: 500 })
  }
}
