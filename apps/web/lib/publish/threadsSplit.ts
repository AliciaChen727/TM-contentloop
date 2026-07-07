// Split a long caption into Threads-sized segments. Threads caps each post at
// 500 chars; overflow is published as a reply chain (主貼 → 留言 → 留言…), so a
// long caption isn't blocked — it becomes a thread. Segments break on paragraph
// then sentence boundaries to stay readable; a single over-long unit is hard-cut.
// See docs/agent-auto-publish-plan.md §5.5 / SKILL auto-publish-agent.

export const THREADS_LIMIT = 500

export function splitForThreads(text: string, limit = THREADS_LIMIT): string[] {
  const clean = (text ?? '').trim()
  if (clean.length <= limit) return clean ? [clean] : []

  // Break into paragraphs first, keeping blank-line separation intact.
  const paras = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const units: string[] = []
  for (const p of paras) {
    if (p.length <= limit) { units.push(p); continue }
    // Paragraph too long → split by sentence enders (keep the punctuation).
    const sentences = p.match(/[^。！？!?\n]+[。！？!?]?/g) ?? [p]
    let buf = ''
    for (const s of sentences) {
      if (s.length > limit) {
        // A single sentence longer than the limit → hard-slice.
        if (buf) { units.push(buf.trim()); buf = '' }
        for (let i = 0; i < s.length; i += limit) units.push(s.slice(i, i + limit))
      } else if ((buf + s).length > limit) {
        units.push(buf.trim()); buf = s
      } else buf += s
    }
    if (buf.trim()) units.push(buf.trim())
  }

  // Greedily pack units into ≤limit segments, re-joining with blank lines.
  const segments: string[] = []
  let cur = ''
  for (const u of units) {
    const joined = cur ? `${cur}\n\n${u}` : u
    if (joined.length > limit) { if (cur) segments.push(cur); cur = u }
    else cur = joined
  }
  if (cur) segments.push(cur)
  return segments
}
