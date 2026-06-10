// Meta Conversions API (server-side conversion upload). Lets us report a
// registration (with value) back to Meta so the Ads Manager can compute ROAS —
// without any browser Pixel code. Uses the Pixel/Dataset access token generated
// in Events Manager (no App Review needed, unlike ad-write Marketing API).
const GRAPH = 'https://graph.facebook.com/v21.0'

export interface CapiInput {
  pixelId: string
  accessToken: string
  eventName: 'Purchase' | 'CompleteRegistration'
  eventId: string                 // = clickId, dedup key (also dedups vs Pixel)
  eventSourceUrl?: string
  fbc?: string | null             // fb.1.<ts>.<fbclid> — strongest ad attribution
  ip?: string | null              // client_ip_address (raw, for matching)
  ua?: string | null              // client_user_agent
  value?: number
  currency?: string
  testEventCode?: string          // set → event shows under Events Manager “Test Events”
}

// Returns ok:false with a human message rather than throwing — callers must
// never let a Meta hiccup block the user's redirect or break a conversion write.
export async function sendCapiEvent(e: CapiInput): Promise<{ ok: boolean; error?: string }> {
  const user_data: Record<string, unknown> = {}
  if (e.fbc) user_data.fbc = e.fbc
  if (e.ip) user_data.client_ip_address = e.ip
  if (e.ua) user_data.client_user_agent = e.ua
  // Meta requires at least one identifier in user_data.
  if (Object.keys(user_data).length === 0) return { ok: false, error: 'no user identifiers (fbc/ip/ua) to match' }

  const custom_data: Record<string, unknown> = {}
  if (e.eventName === 'Purchase') { custom_data.value = e.value ?? 0; custom_data.currency = e.currency ?? 'TWD' }

  const payload: Record<string, unknown> = {
    data: [{
      event_name: e.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: e.eventId,
      action_source: 'website',
      ...(e.eventSourceUrl ? { event_source_url: e.eventSourceUrl } : {}),
      user_data,
      custom_data,
    }],
  }
  if (e.testEventCode) payload.test_event_code = e.testEventCode

  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(e.pixelId)}/events?access_token=${encodeURIComponent(e.accessToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (!res.ok) return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' }
  }
}

// Build the fbc identifier from the fbclid Meta appends to the ad's destination.
export function buildFbc(fbclid: string, ts = Date.now()): string {
  return `fb.1.${ts}.${fbclid}`
}
