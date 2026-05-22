const BASE = 'https://graph.facebook.com/v19.0'

export interface FollowerDay {
  date: string   // YYYY-MM-DD
  total: number  // running total followers on that day
  adds: number   // new follows that day
  removes: number // unfollows that day
  net: number    // adds - removes
}

// metricName -> (date -> value), or null if the whole request errored
async function fetchInsight(
  pageId: string,
  accessToken: string,
  metrics: string,
  since: string,
  until: string,
): Promise<Record<string, Map<string, number>> | null> {
  try {
    const url = new URL(`${BASE}/${pageId}/insights`)
    url.searchParams.set('metric', metrics)
    url.searchParams.set('period', 'day')
    url.searchParams.set('since', since)
    url.searchParams.set('until', until)
    url.searchParams.set('access_token', accessToken)
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok || data.error) return null
    const out: Record<string, Map<string, number>> = {}
    for (const item of (data.data ?? []) as { name: string; values?: { end_time?: string; value?: unknown }[] }[]) {
      const m = new Map<string, number>()
      for (const v of item.values ?? []) {
        const date = v.end_time?.slice(0, 10)
        if (date) m.set(date, Number(v.value) || 0)
      }
      out[item.name] = m
    }
    return out
  } catch {
    return null
  }
}

// Current follower/like total via reliable node fields (works even when the
// insights time-series metrics are unavailable/deprecated for this page).
async function fetchCurrentTotal(pageId: string, accessToken: string): Promise<number | null> {
  try {
    const url = new URL(`${BASE}/${pageId}`)
    url.searchParams.set('fields', 'followers_count,fan_count')
    url.searchParams.set('access_token', accessToken)
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok || data.error) return null
    const v = (data.followers_count as number | undefined) ?? (data.fan_count as number | undefined)
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

/**
 * Fetch page-level follower stats as a daily time series.
 * Requires `read_insights`. Meta has deprecated many page_* insights metrics and
 * hides data for pages with <100 followers — so we degrade gracefully:
 *   1. try several insights metric sets for the historical daily trend
 *   2. always anchor today's point with the reliable `followers_count` node field
 * Returns [] only if even the node field is unavailable.
 */
export async function fetchPageFollowerStats(
  pageId: string,
  accessToken: string,
  sinceDays = 90,
): Promise<FollowerDay[]> {
  const untilTs = Math.floor(Date.now() / 1000)
  const sinceTs = untilTs - sinceDays * 86400
  const since = String(sinceTs)
  const until = String(untilTs)

  // Try modern follows metrics first, then legacy fans metrics, then totals only.
  const attempts = [
    'page_follows,page_daily_follows_unique,page_daily_unfollows_unique',
    'page_fans,page_fan_adds,page_fan_removes',
    'page_follows',
    'page_fans',
  ]
  let res: Record<string, Map<string, number>> | null = null
  for (const metrics of attempts) {
    const r = await fetchInsight(pageId, accessToken, metrics, since, until)
    if (r && Object.keys(r).length > 0) { res = r; break }
  }

  const rows: FollowerDay[] = []
  if (res) {
    const totals = res['page_follows'] ?? res['page_fans'] ?? new Map<string, number>()
    const adds = res['page_daily_follows_unique'] ?? res['page_fan_adds'] ?? new Map<string, number>()
    const removes = res['page_daily_unfollows_unique'] ?? res['page_fan_removes'] ?? new Map<string, number>()

    const dates = new Set<string>()
    for (const k of Array.from(totals.keys())) dates.add(k)
    for (const k of Array.from(adds.keys())) dates.add(k)
    for (const k of Array.from(removes.keys())) dates.add(k)
    for (const date of Array.from(dates).sort()) {
      const a = adds.get(date) ?? 0
      const r = removes.get(date) ?? 0
      rows.push({ date, total: totals.get(date) ?? 0, adds: a, removes: r, net: a - r })
    }
  }

  // Anchor today's point with the reliable current total (fixes all-zero series).
  const nodeTotal = await fetchCurrentTotal(pageId, accessToken)
  const today = new Date().toISOString().slice(0, 10)
  if (nodeTotal != null) {
    const last = rows[rows.length - 1]
    if (last && last.date === today) last.total = nodeTotal
    else rows.push({ date: today, total: nodeTotal, adds: 0, removes: 0, net: 0 })
  }

  return rows
}
