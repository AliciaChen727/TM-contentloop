// Thin Gemini text client (Generative Language API, NOT Vertex). Used by the
// Quality evaluator as a cross-model judge. Throws on any failure so callers can
// fall back to Claude. Key: caller passes it (env GEMINI_API_KEY or a user key).

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiTextOpts {
  apiKey: string
  prompt: string
  system?: string
  model?: string        // default gemini-2.5-flash
  temperature?: number
  maxOutputTokens?: number
}

export async function geminiGenerateText(opts: GeminiTextOpts): Promise<string> {
  const model = opts.model ?? 'gemini-2.5-flash'
  const url = `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
      // 2.5-flash enables "thinking" by default, which consumes the output token
      // budget and can return empty visible text. We don't need reasoning tokens
      // for structured JSON tasks, so disable it.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data?.error?.message ?? `gemini ${res.status}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
  if (!text) throw new Error('gemini empty response')
  return text
}

// Quick liveness probe so callers can decide Gemini-vs-Claude once and cache it.
export async function geminiKeyWorks(apiKey: string): Promise<boolean> {
  try {
    await geminiGenerateText({ apiKey, prompt: 'ping', maxOutputTokens: 5 })
    return true
  } catch {
    return false
  }
}
