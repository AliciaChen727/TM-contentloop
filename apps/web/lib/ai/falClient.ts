// Thin wrapper around fal.ai's synchronous run endpoint. Used for fast image
// models (Recraft V3, FLUX) where the result returns within the request.
// FAL_KEY must be set in the environment (Vercel env / Secret Manager) — never
// committed.
const FAL_BASE = 'https://fal.run'

export interface FalImage {
  url: string
  content_type?: string
}

// GPT Image 2 can take 60-90s; other models are fast. Use a per-model timeout
// so the function returns a clean error before Vercel's hard 120s cutoff.
const MODEL_TIMEOUT_MS: Record<string, number> = {
  'fal-ai/gpt-image-2': 110_000,
}
const DEFAULT_TIMEOUT_MS = 55_000

export async function falGenerateImage(
  model: string,
  input: Record<string, unknown>,
): Promise<FalImage> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not configured')

  const timeoutMs = MODEL_TIMEOUT_MS[model] ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${FAL_BASE}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('圖片生成逾時，請改用 Grok Imagine 或 Recraft V3，或稍後再試')
    }
    throw e
  }
  clearTimeout(timer)

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.detail || data?.error || `fal ${model} failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  const image = data?.images?.[0]
  if (!image?.url) throw new Error('fal: no image in response')
  return { url: image.url, content_type: image.content_type }
}
