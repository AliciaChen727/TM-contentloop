import { GoogleAuth } from 'google-auth-library'
import { falGenerateImage } from './falClient'

// Image-generation engine abstraction. Routing by use case:
//  - vertex-imagen: general photoreal (default; existing GCP service account)
//  - fal-recraft:    ad creative with readable in-image text (Recraft V3)
//  - fal-flux:       fast general-purpose diffusion (FLUX dev)
export type ImageEngine = 'vertex-imagen' | 'fal-recraft' | 'fal-flux'

export interface GenerateImageResult {
  imageData: string // base64, no data: prefix
  mimeType: string
}

const FAL_MODELS: Record<'fal-recraft' | 'fal-flux', string> = {
  'fal-recraft': 'fal-ai/recraft-v3',
  'fal-flux': 'fal-ai/flux/dev',
}

export async function generateImage(
  engine: ImageEngine,
  prompt: string,
): Promise<GenerateImageResult> {
  switch (engine) {
    case 'fal-recraft':
    case 'fal-flux':
      return viaFal(FAL_MODELS[engine], prompt)
    case 'vertex-imagen':
    default:
      return viaVertexImagen(prompt)
  }
}

// fal returns a hosted URL; download and normalise to base64 so the response
// shape matches Vertex (and downstream Canva asset upload gets raw bytes).
async function viaFal(model: string, prompt: string): Promise<GenerateImageResult> {
  const { url, content_type } = await falGenerateImage(model, { prompt })
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`fal: failed to download generated image (${imgRes.status})`)
  const buf = Buffer.from(await imgRes.arrayBuffer())
  return {
    imageData: buf.toString('base64'),
    mimeType: content_type ?? imgRes.headers.get('content-type') ?? 'image/png',
  }
}

async function viaVertexImagen(prompt: string): Promise<GenerateImageResult> {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('GCP Service Account not configured')

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
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'Image generation failed')

  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('No image in response')
  return { imageData: b64, mimeType: data.predictions?.[0]?.mimeType ?? 'image/jpeg' }
}
