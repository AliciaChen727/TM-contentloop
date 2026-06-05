export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import { exchangeThreadsCode, saveThreadsToken } from '@/lib/threads/client'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthErr = searchParams.get('error')

  const jar = await cookies()
  const savedState = jar.get('threads_oauth_state')?.value
  const idToken = jar.get('threads_oauth_id_token')?.value
  const pageId = jar.get('threads_oauth_page_id')?.value ?? ''
  jar.delete('threads_oauth_state'); jar.delete('threads_oauth_id_token'); jar.delete('threads_oauth_page_id')

  const origin = req.nextUrl.origin
  const respond = (status: 'connected' | 'error', reason?: string) => {
    if (status === 'error') console.error('[threads/callback] failed:', reason)
    const result = JSON.stringify({ type: 'threads-result', status, reason: reason ?? null })
    const fallback = `/dashboard/settings?threads=${status}${reason ? `&reason=${reason}` : ''}`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Threads</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;color:#555">處理中…
<script>(function(){var r=${result};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(r,${JSON.stringify(origin)});window.close();return;}}catch(e){}window.location.replace(${JSON.stringify(fallback)});})();</script></body></html>`
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  if (oauthErr) return respond('error', `oauth_${oauthErr}`)
  if (!code) return respond('error', 'no_code')
  if (!state || !savedState || state !== savedState) return respond('error', 'bad_state')
  if (!idToken) return respond('error', 'no_id_token')

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return respond('error', 'bad_id_token') }

  const redirectUri = process.env.THREADS_REDIRECT_URI ?? `${origin}/api/auth/threads/callback`
  try {
    const { userId, accessToken, expiresIn } = await exchangeThreadsCode(code, redirectUri)
    await saveThreadsToken(uid, pageId, { threadsUserId: userId, accessToken, expiresAt: Date.now() + expiresIn * 1000 })
    return respond('connected')
  } catch (e) {
    return respond('error', e instanceof Error ? e.message.slice(0, 40) : 'exchange_failed')
  }
}
