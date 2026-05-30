// Thin wrapper around fal.ai's synchronous run endpoint. Used for fast image
// models (Recraft V3, FLUX) where the result returns within the request.
// FAL_KEY must be set in the environment (Vercel env / Secret Manager) — never
// committed.
const FAL_BASE = 'https://fal.run'

export interface FalImage {
  url: string
  content_type?: string
}

export async function falGenerateImage(
  model: string,
  input: Record<string, unknown>,
): Promise<FalImage> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not configured')

  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.detail || data?.error || `fal ${model} failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  const image = data?.images?.[0]
  if (!image?.url) throw new Error('fal: no image in response')
  return { url: image.url, content_type: image.content_type }
}
