// fal video engines (async queue). Video generation takes 1–3 min, so we use
// fal's queue API: submit → poll status → fetch result URL. The existing
// /api/ai/video route already polls (built for Vertex Veo), so these slot in.
const FAL_QUEUE = 'https://queue.fal.run'

export type FalVideoEngine = 'fal-hailuo' | 'fal-grok-video' | 'fal-kling-26'

interface FalVideoConfig {
  model: string
  seconds: number // billed/quota seconds for this engine's default duration
  input: (prompt: string) => Record<string, unknown>
}

// All set to 9:16 vertical (Reels). Durations match each model's safe default.
const FAL_VIDEO: Record<FalVideoEngine, FalVideoConfig> = {
  'fal-hailuo': {
    model: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    seconds: 6,
    input: p => ({ prompt: p, duration: '6', aspect_ratio: '9:16' }),
  },
  'fal-grok-video': {
    model: 'xai/grok-imagine-video/text-to-video',
    seconds: 6,
    input: p => ({ prompt: p, duration: 6, aspect_ratio: '9:16', resolution: '720p' }),
  },
  'fal-kling-26': {
    model: 'fal-ai/kling-video/v2.6/pro/text-to-video',
    seconds: 5,
    input: p => ({ prompt: p, duration: '5', aspect_ratio: '9:16' }),
  },
}

export function isFalVideoEngine(e: string): e is FalVideoEngine {
  return e in FAL_VIDEO
}

export function falVideoSeconds(engine: FalVideoEngine): number {
  return FAL_VIDEO[engine]?.seconds ?? 6
}

// Submit a generation job; returns the model id + request id for polling.
export async function submitFalVideo(engine: FalVideoEngine, prompt: string): Promise<{ model: string; requestId: string }> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not configured')
  const cfg = FAL_VIDEO[engine]
  if (!cfg) throw new Error(`unknown video engine: ${engine}`)

  const res = await fetch(`${FAL_QUEUE}/${cfg.model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg.input(prompt)),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.request_id) {
    const msg = data?.detail || data?.error || `fal video submit failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return { model: cfg.model, requestId: data.request_id }
}

// Poll a job; when complete returns the hosted video URL.
export async function pollFalVideo(model: string, requestId: string): Promise<{ done: boolean; videoUrl?: string; error?: string }> {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not configured')

  const statusRes = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${key}` },
  })
  const st = await statusRes.json().catch(() => ({}))
  if (st.status === 'COMPLETED') {
    const r = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}`, {
      headers: { Authorization: `Key ${key}` },
    })
    const out = await r.json().catch(() => ({}))
    const url = out?.video?.url
    if (!url) return { done: true, error: 'no video url in result' }
    return { done: true, videoUrl: url }
  }
  // IN_QUEUE / IN_PROGRESS
  return { done: false }
}
