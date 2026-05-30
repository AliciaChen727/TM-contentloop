export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import crypto from 'crypto'

const SCOPES = [
  'asset:read',
  'asset:write',
  'design:content:read',
  'design:content:write', // 讓 AI 能用 Create Design API 產出優化後的新設計稿
  'design:meta:read',
  'profile:read',
].join(' ')

export async function GET(req: NextRequest) {
  const idToken = req.nextUrl.searchParams.get('idToken')
  if (!idToken) return NextResponse.json({ error: 'Missing idToken' }, { status: 400 })

  try {
    await adminAuth.verifyIdToken(idToken)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const state = crypto.randomBytes(16).toString('hex')

  // Canva OAuth requires PKCE (RFC 7636). Without code_challenge the
  // authorize endpoint returns 400. code_verifier is 43-128 chars from the
  // unreserved set; base64url of 32 random bytes satisfies this.
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  const params = new URLSearchParams({
    client_id: process.env.CANVA_CLIENT_ID!,
    redirect_uri: process.env.CANVA_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const res = NextResponse.redirect(
    `https://www.canva.com/api/oauth/authorize?${params}`,
  )

  // IMPORTANT: set cookies on the redirect response itself. Cookies set via
  // next/headers cookies() are NOT attached to a manually-built
  // NextResponse.redirect(), so the browser never stores them and the callback
  // can't verify state / find the code_verifier → connection silently fails.
  // sameSite 'lax' so the cookies survive Canva's top-level GET redirect back.
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  }
  res.cookies.set('canva_oauth_state', state, cookieOpts)
  res.cookies.set('canva_oauth_verifier', codeVerifier, cookieOpts)
  // Stash the idToken in a short-lived cookie so callback can identify the user
  res.cookies.set('canva_oauth_id_token', idToken, cookieOpts)

  return res
}
