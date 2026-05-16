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
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: ['IMAGE', 'TEXT'] },
    })

    const parts = result.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(p => p.inlineData?.data)
    if (!imagePart?.inlineData?.data) {
      return NextResponse.json({ error: 'No image in response' }, { status: 500 })
    }

    return NextResponse.json({
      imageData: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? 'image/png',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Image generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
