export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'

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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1 }
      }),
    }
  )

  const data = await geminiRes.json()
  if (!geminiRes.ok || data.error) {
    return NextResponse.json({ error: data.error?.message ?? 'Image generation failed' }, { status: 500 })
  }

  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  const mime = data.predictions?.[0]?.mimeType ?? 'image/jpeg'
  
  if (!b64) {
    return NextResponse.json({ error: 'No image in response' }, { status: 500 })
  }

  return NextResponse.json({
    imageData: b64,
    mimeType: mime,
  })
}
