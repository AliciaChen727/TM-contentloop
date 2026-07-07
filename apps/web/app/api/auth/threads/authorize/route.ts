export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import crypto from 'crypto'
import { THREADS_APP_ID } from '@/lib/threads/client'

// threads_manage_insights: read post/account metrics.
// threads_content_publish: publish posts (S4a real publishing).
// threads_manage_replies: publish REPLIES (the reply-chain for long posts).
const SCOPES = 'threads_basic,threads_manage_insights,threads_content_publish,threads_manage_replies'

export async function GET(req: NextRequest) {
  const idToken = req.nextUrl.searchParams.get('idToken')
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!idToken) return NextResponse.json({ error: 'Missing idToken' }, { status: 400 })
  try { await adminAuth.verifyIdToken(idToken) }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = process.env.THREADS_REDIRECT_URI ?? `${req.nextUrl.origin}/api/auth/threads/callback`

  const params = new URLSearchParams({
    client_id: THREADS_APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  })
  const res = NextResponse.redirect(`https://threads.net/oauth/authorize?${params.toString()}`)

  // Set cookies on the redirect response (so they persist through the Threads
  // top-level redirect back to /callback). uid + pageId recovered there.
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 600, path: '/' }
  res.cookies.set('threads_oauth_state', state, opts)
  res.cookies.set('threads_oauth_id_token', idToken, opts)
  res.cookies.set('threads_oauth_page_id', pageId, opts)
  return res
}
