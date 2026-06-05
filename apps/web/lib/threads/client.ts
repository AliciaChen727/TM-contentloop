// Threads API client helpers. Threads has its OWN OAuth + endpoint
// (graph.threads.net), separate from the FB/IG Graph API. Token stored per-page
// under users/{uid}/threadsTokens/{pageId} (NOT metaTokens — that would pollute
// the /api/pages list). See docs/threads-integration-poc.md.

import { adminDb } from '@/lib/firebase/admin'

export const GRAPH = 'https://graph.threads.net'
export const THREADS_APP_ID = process.env.THREADS_APP_ID ?? '2002043263737531'

export interface ThreadsToken {
  threadsUserId: string
  accessToken: string
  expiresAt: number      // epoch ms
  pageId: string
}

export async function saveThreadsToken(
  uid: string, pageId: string, t: { threadsUserId: string; accessToken: string; expiresAt: number },
): Promise<void> {
  await adminDb.collection('users').doc(uid).collection('threadsTokens').doc(pageId)
    .set({ ...t, pageId, connectedAt: Date.now() }, { merge: true })
}

export async function getThreadsToken(uid: string, pageId: string): Promise<ThreadsToken | null> {
  const d = await adminDb.collection('users').doc(uid).collection('threadsTokens').doc(pageId).get()
  return d.exists ? (d.data() as ThreadsToken) : null
}

// Exchange an authorization code → short-lived token (+ user_id) → long-lived
// (60-day) token. Falls back to the short token if the long-lived exchange fails.
export async function exchangeThreadsCode(
  code: string, redirectUri: string,
): Promise<{ userId: string; accessToken: string; expiresIn: number }> {
  const secret = process.env.THREADS_APP_SECRET ?? ''
  const shortRes = await fetch(`${GRAPH}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: THREADS_APP_ID, client_secret: secret,
      grant_type: 'authorization_code', redirect_uri: redirectUri, code,
    }),
  })
  const short = await shortRes.json()
  if (!shortRes.ok || short.error) throw new Error(short.error?.message ?? `threads token exchange ${shortRes.status}`)
  const shortToken = String(short.access_token)
  const userId = String(short.user_id)

  const longRes = await fetch(`${GRAPH}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(shortToken)}`)
  const long = await longRes.json().catch(() => ({}))
  if (!longRes.ok || long.error || !long.access_token) {
    return { userId, accessToken: shortToken, expiresIn: 3600 }
  }
  return { userId, accessToken: String(long.access_token), expiresIn: Number(long.expires_in) || 5184000 }
}
