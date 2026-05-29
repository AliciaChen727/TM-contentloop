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
  const idToken = cookieStore.get('canva_oauth_id_token')?.value

  cookieStore.delete('canva_oauth_state')
  cookieStore.delete('canva_oauth_id_token')

  if (error) {
    return NextResponse.redirect(new URL('/dashboard/settings?canva=error', req.nextUrl.origin))
  }
  if (!code || !state || state !== savedState || !idToken) {
    return NextResponse.redirect(new URL('/dashboard/settings?canva=error', req.nextUrl.origin))
  }

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.redirect(new URL('/dashboard/settings?canva=error', req.nextUrl.origin))
  }

  const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.CANVA_REDIRECT_URI!,
      client_id: process.env.CANVA_CLIENT_ID!,
      client_secret: process.env.CANVA_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/dashboard/settings?canva=error', req.nextUrl.origin))
  }

  const data = await tokenRes.json()
  await saveCanvaTokens(uid, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  return NextResponse.redirect(new URL('/dashboard/settings?canva=connected', req.nextUrl.origin))
}
