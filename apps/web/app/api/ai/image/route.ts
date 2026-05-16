export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { adminAuth } from '@/lib/firebase/admin'
import { getUserApiKey } from '@/lib/userApiKeys'

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const apiKey = await getUserApiKey(uid, 'gemini')
  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'gemini' }, { status: 402 })

  const { prompt } = await req.json() as { prompt: string }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })

  try {
    const ai = new GoogleGenAI({ apiKey })
    const result = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
    })

    const b64 = result.generatedImages?.[0]?.image?.imageBytes
    if (!b64) return NextResponse.json({ error: 'No image in response' }, { status: 500 })

    return NextResponse.json({ imageData: b64, mimeType: 'image/jpeg' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Image generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
