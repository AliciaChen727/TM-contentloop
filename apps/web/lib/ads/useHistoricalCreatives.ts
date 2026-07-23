'use client'
import { useState, useMemo, useEffect } from 'react'
import type { AdData } from '@/components/ads/types'

// Shared hook. The canonical adInsights/latest snapshot is a rolling ~30-day window,
// so any dashboard section that shows per-creative data (Creative Ranking, Budget —
// both derive from the same creatives) goes blank for older ranges. When the selected
// range STARTS earlier than that window, fetch the range's creatives on-demand from
// Meta (read-only /api/ads/creatives, page-isolated). Recent ranges use the snapshot.
export function useHistoricalCreatives(
  dateFrom?: string,
  dateTo?: string,
  pageId?: string,
  idToken?: string,
): { creatives: AdData['creatives'] | null; loading: boolean; exceedsWindow: boolean } {
  const exceedsWindow = useMemo(() => {
    if (!dateFrom) return false
    return new Date(dateFrom + 'T00:00:00Z').getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000
  }, [dateFrom])

  const [creatives, setCreatives] = useState<AdData['creatives'] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!exceedsWindow || !pageId || !idToken || !dateFrom || !dateTo) { setCreatives(null); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/ads/creatives?pageId=${encodeURIComponent(pageId)}&since=${dateFrom}&until=${dateTo}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(j => { if (!cancelled) setCreatives((j.creatives ?? []) as AdData['creatives']) })
      .catch(() => { if (!cancelled) setCreatives([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [exceedsWindow, pageId, idToken, dateFrom, dateTo])

  return { creatives, loading, exceedsWindow }
}
