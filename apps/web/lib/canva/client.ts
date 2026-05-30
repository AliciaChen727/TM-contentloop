import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const CANVA_API = 'https://api.canva.com/rest/v1'
const TOKEN_ENDPOINT = `${CANVA_API}/oauth/token`

interface CanvaTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export async function getCanvaTokens(uid: string): Promise<CanvaTokens | null> {
  const snap = await adminDb
    .collection('users').doc(uid)
    .collection('integrations').doc('canva')
    .get()
  const d = snap.data()
  if (!d?.accessToken) return null
  return { accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: d.expiresAt }
}

export async function saveCanvaTokens(uid: string, tokens: CanvaTokens): Promise<void> {
  await adminDb
    .collection('users').doc(uid)
    .collection('integrations').doc('canva')
    .set({ ...tokens, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
}

async function refreshAccessToken(uid: string, refreshToken: string): Promise<CanvaTokens> {
  // Canva authenticates the client via HTTP Basic auth, not body credentials.
  const basic = Buffer.from(
    `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`,
  ).toString('base64')
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data = await res.json()
  const tokens: CanvaTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  await saveCanvaTokens(uid, tokens)
  return tokens
}

export async function getValidAccessToken(uid: string): Promise<string> {
  const tokens = await getCanvaTokens(uid)
  if (!tokens) throw new Error('CANVA_NOT_CONNECTED')
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken
  const refreshed = await refreshAccessToken(uid, tokens.refreshToken)
  return refreshed.accessToken
}

export async function canvaFetch(
  uid: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getValidAccessToken(uid)
  return fetch(`${CANVA_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}
