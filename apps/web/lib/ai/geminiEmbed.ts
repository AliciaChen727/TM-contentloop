// Gemini text embeddings (gemini-embedding-001, 3072-dim) for semantic retrieval
// of past Sidekick replies. Throws on failure so callers fall back to metadata
// retrieval. Model verified available on this project's key (text-embedding-004
// is NOT exposed here).

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'gemini-embedding-001'

export async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const url = `${BASE}/models/${MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data?.error?.message ?? `embed ${res.status}`)
  const values = data.embedding?.values
  if (!Array.isArray(values) || values.length === 0) throw new Error('embed empty')
  return values
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
