// GA4 (Google Analytics) data shapes — shared by the sync route and the
// frontend GaSection. Channel-level e-commerce performance for one date range.

export interface GaChannelRow {
  channel: string        // sessionDefaultChannelGroup, e.g. "Paid Search", "Organic Social"
  sessions: number
  users: number
  conversions: number
  revenue: number        // purchaseRevenue (TWD)
  purchases: number      // ecommercePurchases
  adCost: number         // advertiserAdCost — 0 if GA4 not linked to Google Ads
  adClicks: number
  roas: number           // revenue / adCost (0 when no cost)
}

export interface GaTotals {
  sessions: number
  users: number
  conversions: number
  revenue: number
  purchases: number
  adCost: number
  adClicks: number
  roas: number
}

export interface GaSummary {
  propertyId: string
  dateRange: { from: string; to: string }
  totals: GaTotals
  channels: GaChannelRow[]
  adsLinked: boolean     // true if any adCost > 0 (GA4↔Google Ads link active)
  syncedAt: string       // ISO
}
