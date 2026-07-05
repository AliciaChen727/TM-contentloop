// Parse a pasted meeting schedule (from Google Sheets / Excel copy = TSV, or
// free text) into {date, label} entries. Owner-side data, parsed client-side.
// Handles per-column (tab-separated) and per-line layouts, and common date forms.
export interface ParsedEntry { date: string; label: string }

const DATE_RE = /(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/

export function parseSchedule(text: string): ParsedEntry[] {
  const segs = (text || '').split(/[\t\n\r]+/)
  const found = new Map<string, string>() // date(ISO) -> label
  for (const seg of segs) {
    const m = seg.match(DATE_RE)
    if (!m) continue
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    // label = the rest of this segment (keeps "#683" etc.); trimmed of stray punctuation.
    const label = seg.replace(m[0], '').replace(/^[#\s、,:：-]+|[#\s、,:：-]+$/g, '').trim().slice(0, 200)
    if (!found.has(iso)) found.set(iso, label)
  }
  return Array.from(found.entries())
    .map(([date, label]) => ({ date, label }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// The next meeting at or after today (local ISO date). Used by 5-2b to answer
// "when's the next meeting" deterministically instead of trusting LLM date math.
export function nextMeeting(entries: ParsedEntry[], todayIso: string): ParsedEntry | null {
  return entries.filter(e => e.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
