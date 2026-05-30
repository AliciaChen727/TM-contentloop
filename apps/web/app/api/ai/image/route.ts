export const dynamic = 'force-dynamic'
// Some engines (gpt-image-2) can take 60-90s; use 120s to stay under Vercel Pro limit.
export const maxDuration = 120
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { recordImageGeneration } from '@/lib/usage'
import { checkImageQuota } from '@/lib/quota'
import { generateImage, type ImageEngine } from '@/lib/ai/generateImage'

const VALID_ENGINES: ImageEngine[] = ['vertex-imagen', 'fal-recraft', 'fal-flux', 'fal-grok-image', 'fal-gpt-image-2']

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

  const quota = await checkImageQuota(uid)
  if (!quota.ok) {
    return NextResponse.json(
      { error: `本月圖片額度已用盡（${quota.used}/${quota.limit} 張）。升級 Pro 方案可獲得更多額度。` },
      { status: 429 }
    )
  }

  const { prompt, engine } = await req.json() as { prompt: string; engine?: ImageEngine }
  if (!prompt?.trim()) return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })

  // Default to Vertex Imagen for backward compatibility; only honour known engines.
  const chosen: ImageEngine = engine && VALID_ENGINES.includes(engine) ? engine : 'vertex-imagen'

  try {
    const { imageData, mimeType } = await generateImage(chosen, prompt)
    await recordImageGeneration(uid)
    return NextResponse.json({ imageData, mimeType, engine: chosen })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal server error' }, { status: 500 })
  }
}
