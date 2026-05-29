export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import crypto from 'crypto'

const SCOPES = [
  'asset:read',
  'asset:write',
  'design:content:read',
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
  const cookieStore = await cookies()
  cookieStore.set('canva_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  })
  // Stash the idToken in a short-lived cookie so callback can identify the user
  cookieStore.set('canva_oauth_id_token', idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  })

  const params = new URLSearchParams({
    client_id: process.env.CANVA_CLIENT_ID!,
    redirect_uri: process.env.CANVA_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES,
    state,
  })

  return NextResponse.redirect(
    `https://www.canva.com/api/oauth/authorize?${params}`,
  )
}
