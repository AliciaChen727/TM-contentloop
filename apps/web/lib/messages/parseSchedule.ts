// Parse a pasted meeting schedule (from Google Sheets / Excel copy = TSV, or
// free text) into {date, label} entries. Owner-side data, parsed client-side.
// Handles per-column (tab-separated) and per-line layouts, and common date forms.
export interface ParsedEntry { date: string; label: string }

const DATE_RE = /(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/
// A "meeting marker": a session number (#683) or common meeting keywords. When
// the input contains ANY marked date, we keep ONLY marked dates (filters out
// stray dates like reminders/holidays). If nothing is marked, keep all dates
// (so plain date lists still work).
const MARKER_RE = /#\s*\d+|例會|會次|meeting|例\s*會|第\s*\d+\s*次/i

export function parseSchedule(text: string): ParsedEntry[] {
  const segs = (text || '').split(/[\t\n\r]+/)
  const found = new Map<string, { label: string; marked: boolean }>() // date(ISO) -> info
  for (const seg of segs) {
    const m = seg.match(DATE_RE)
    if (!m) continue
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const marked = MARKER_RE.test(seg)
    // label = the rest of this segment (keeps "#683" etc.); trimmed of stray punctuation.
    const label = seg.replace(m[0], '').replace(/^[#\s、,:：-]+|[#\s、,:：-]+$/g, '').trim().slice(0, 200)
    const prev = found.get(iso)
    if (!prev || (marked && !prev.marked)) found.set(iso, { label, marked }) // prefer the marked occurrence
  }
  const all = Array.from(found.entries()).map(([date, v]) => ({ date, label: v.label, marked: v.marked }))
  const anyMarked = all.some(e => e.marked)
  return all
    .filter(e => !anyMarked || e.marked)
    .map(({ date, label }) => ({ date, label }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// The next meeting at or after today (local ISO date). Used by 5-2b to answer
// "when's the next meeting" deterministically instead of trusting LLM date math.
export function nextMeeting(entries: ParsedEntry[], todayIso: string): ParsedEntry | null {
  return entries.filter(e => e.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
