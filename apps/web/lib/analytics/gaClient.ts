// GA4 Data API client — server-only. Mirrors the Vertex AI auth pattern in
// lib/ai/generateImage.ts: GoogleAuth with the firebase-adminsdk service
// account, then a REST call (no extra SDK dependency).
//
// Prereq: the SA email (FIREBASE_ADMIN_CLIENT_EMAIL) must be granted "Viewer"
// on the target GA4 property, and the Google Analytics Data API enabled in GCP.

import { GoogleAuth } from 'google-auth-library'
import type { GaSummary, GaChannelRow, GaTotals } from './gaTypes'

const GA_BASE = 'https://analyticsdata.googleapis.com/v1beta'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface GaRow { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }

// Order matters — maps 1:1 to the parsing below.
const METRICS = [
  'sessions', 'totalUsers', 'conversions', 'purchaseRevenue',
  'ecommercePurchases', 'advertiserAdCost', 'advertiserAdClicks', 'returnOnAdSpend',
] as const

async function getAccessToken(): Promise<string> {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('GCP Service Account not configured')
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  })
  const token = await auth.getAccessToken()
  if (!token) throw new Error('Failed to obtain GA access token')
  return token
}

const n = (v?: string) => (v ? Number(v) || 0 : 0)

/**
 * Run a channel-level e-commerce report for the given GA4 property + date range.
 * propertyId may be "123456789" or "properties/123456789".
 */
export async function runGaChannelReport(
  propertyId: string,
  since: string,
  until: string,
): Promise<GaSummary> {
  const pid = propertyId.replace(/^properties\//, '')
  const token = await getAccessToken()

  const res = await fetch(`${GA_BASE}/properties/${pid}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: METRICS.map(name => ({ name })),
      limit: 100,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `GA report failed (${res.status})`)
  }

  const rows: GaRow[] = data.rows ?? []
  const channels: GaChannelRow[] = rows.map(r => {
    const m = r.metricValues ?? []
    const revenue = n(m[3]?.value)
    const adCost = n(m[5]?.value)
    return {
      channel: r.dimensionValues?.[0]?.value ?? '(other)',
      sessions: n(m[0]?.value),
      users: n(m[1]?.value),
      conversions: n(m[2]?.value),
      revenue,
      purchases: n(m[4]?.value),
      adCost,
      adClicks: n(m[6]?.value),
      roas: adCost > 0 ? Number((revenue / adCost).toFixed(2)) : 0,
    }
  }).sort((a, b) => b.revenue - a.revenue)

  const totals: GaTotals = channels.reduce((t, c) => ({
    sessions: t.sessions + c.sessions,
    users: t.users + c.users,
    conversions: t.conversions + c.conversions,
    revenue: t.revenue + c.revenue,
    purchases: t.purchases + c.purchases,
    adCost: t.adCost + c.adCost,
    adClicks: t.adClicks + c.adClicks,
    roas: 0,
  }), { sessions: 0, users: 0, conversions: 0, revenue: 0, purchases: 0, adCost: 0, adClicks: 0, roas: 0 })
  totals.roas = totals.adCost > 0 ? Number((totals.revenue / totals.adCost).toFixed(2)) : 0

  return {
    propertyId: pid,
    dateRange: { from: since, to: until },
    totals,
    channels,
    adsLinked: totals.adCost > 0,
    syncedAt: new Date().toISOString(),
  }
}
