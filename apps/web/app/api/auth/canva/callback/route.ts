export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { saveCanvaTokens } from '@/lib/canva/client'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const cookieStore = await cookies()
  const savedState = cookieStore.get('canva_oauth_state')?.value
  const codeVerifier = cookieStore.get('canva_oauth_verifier')?.value
  const idToken = cookieStore.get('canva_oauth_id_token')?.value

  cookieStore.delete('canva_oauth_state')
  cookieStore.delete('canva_oauth_verifier')
  cookieStore.delete('canva_oauth_id_token')

  // Surface the precise failure point (reason=...) so connection issues can be
  // diagnosed from the URL without digging through server logs.
  const fail = (reason: string) => {
    console.error('[canva/callback] failed:', reason)
    return NextResponse.redirect(new URL(`/dashboard/settings?canva=error&reason=${reason}`, req.nextUrl.origin))
  }

  if (error) return fail(`oauth_${error}`)
  if (!code) return fail('no_code')
  if (!state || !savedState || state !== savedState) return fail('bad_state')
  if (!codeVerifier) return fail('no_verifier')
  if (!idToken) return fail('no_id_token')

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return fail('bad_id_token')
  }

  // Canva's token endpoint authenticates the client via HTTP Basic auth
  // (base64 of client_id:client_secret), NOT credentials in the body.
  const basic = Buffer.from(
    `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`,
  ).toString('base64')

  const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: process.env.CANVA_REDIRECT_URI!,
    }),
  })

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '')
    console.error('[canva/callback] token exchange failed:', tokenRes.status, detail)
    return fail(`token_${tokenRes.status}`)
  }

  const data = await tokenRes.json()
  await saveCanvaTokens(uid, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  return NextResponse.redirect(new URL('/dashboard/settings?canva=connected', req.nextUrl.origin))
}
