/**
 * GA4 Sync Route — PLACEHOLDER (not yet implemented)
 *
 * This route will sync Google Analytics 4 data into Firestore adInsights.ga
 * once the user connects their GA4 property.
 *
 * Prerequisites before activating:
 * 1. Enable Google Analytics Data API in GCP console:
 *    https://console.developers.google.com/apis/api/analyticsdata.googleapis.com
 * 2. Add GA4 Property ID to user settings (e.g. "G-XXXXXXXXXX")
 * 3. Grant the Firebase service account "Viewer" access in GA4 property settings
 * 4. Set environment variable: GA4_PROPERTY_ID (or store per-user in Firestore)
 *
 * Data to sync (all stored under adInsights.ga in Firestore):
 * - sessions: total sessions for the date range
 * - formPageViews: pageviews of the registration/form landing page
 * - formClicks: goal completions (form submissions via GA Events)
 * - bounceRate: overall bounce rate %
 * - avgSessionDuration: average session duration in seconds
 * - organicSessions: sessions from utm_medium=organic or (none)
 * - paidSessions: sessions from utm_medium=paid (requires UTM params on ad links)
 * - topLandingPages: top 5 landing pages by sessions
 *
 * Implementation plan:
 * - Use @google-analytics/data SDK (BetaAnalyticsDataClient)
 * - Auth: GoogleAuth with existing firebase-adminsdk service account credentials
 *   (same pattern as Vertex AI in /api/ai/image/route.ts)
 * - Run via cron or on-demand, same pattern as /api/cron/sync/route.ts
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function POST() {
  // TODO: Implement GA4 sync when user connects GA property
  return NextResponse.json({
    status: 'not_implemented',
    message: 'GA4 integration is reserved for future implementation. See comments in this file for setup instructions.',
  }, { status: 501 })
}
