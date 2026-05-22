const BASE = 'https://graph.facebook.com/v19.0'

export interface FollowerDay {
  date: string   // YYYY-MM-DD
  total: number  // running total fans/followers on that day
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

/**
 * Fetch page-level follower stats as a daily time series.
 * Requires `read_insights`. Meta hides data for pages with <100 followers, and
 * some metrics vary by API version — so we degrade gracefully: try the full set,
 * fall back to just the running total, and return [] if nothing is available.
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

  // Primary: running total + daily add/remove. Fallback: running total only.
  let res = await fetchInsight(pageId, accessToken, 'page_fans,page_fan_adds,page_fan_removes', since, until)
  if (!res) res = await fetchInsight(pageId, accessToken, 'page_fans', since, until)
  if (!res) return []

  const fans = res['page_fans'] ?? new Map<string, number>()
  const adds = res['page_fan_adds'] ?? new Map<string, number>()
  const removes = res['page_fan_removes'] ?? new Map<string, number>()

  const dates = new Set<string>()
  for (const k of Array.from(fans.keys())) dates.add(k)
  for (const k of Array.from(adds.keys())) dates.add(k)
  for (const k of Array.from(removes.keys())) dates.add(k)
  const rows: FollowerDay[] = []
  for (const date of Array.from(dates).sort()) {
    const a = adds.get(date) ?? 0
    const r = removes.get(date) ?? 0
    rows.push({ date, total: fans.get(date) ?? 0, adds: a, removes: r, net: a - r })
  }
  return rows
}
