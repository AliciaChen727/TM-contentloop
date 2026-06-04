import { auth } from '@/lib/firebase/client'

// Record a creative intent signal — the user took an AI-generated image into
// Canva ('canva_import') or downloaded it ('download'). Fire-and-forget; never
// blocks the user action. Server weights it (import 40 / download 25) and stores
// the generating prompt for few-shot reuse.
export async function fireCreativeSignal(
  pageId: string | undefined,
  prompt: string,
  signal: 'canva_import' | 'download',
): Promise<void> {
  if (!pageId || !prompt?.trim()) return
  try {
    const t = await auth.currentUser?.getIdToken()
    if (!t) return
    await fetch('/api/ai/creative-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ pageId, prompt, signal }),
    })
  } catch { /* best-effort */ }
}
