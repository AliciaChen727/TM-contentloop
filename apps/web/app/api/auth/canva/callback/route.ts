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

  const origin = req.nextUrl.origin

  // The flow runs in a popup so canva.com never enters the main window's
  // history. Return a tiny HTML page that posts the result back to the opener
  // and closes itself; if there's no opener (popup blocked → full-page flow),
  // fall back to redirecting the settings page with ?canva=... (+reason).
  const respond = (status: 'connected' | 'error', reason?: string) => {
    if (status === 'error') console.error('[canva/callback] failed:', reason)
    const result = JSON.stringify({ type: 'canva-result', status, reason: reason ?? null })
    const fallbackUrl = `/dashboard/settings?canva=${status}${reason ? `&reason=${reason}` : ''}`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Canva</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;color:#555">處理中…
<script>
(function(){
  var result = ${result};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(result, ${JSON.stringify(origin)});
      window.close();
      return;
    }
  } catch (e) {}
  window.location.replace(${JSON.stringify(fallbackUrl)});
})();
</script></body></html>`
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  if (error) return respond('error', `oauth_${error}`)
  if (!code) return respond('error', 'no_code')
  if (!state || !savedState || state !== savedState) return respond('error', 'bad_state')
  if (!codeVerifier) return respond('error', 'no_verifier')
  if (!idToken) return respond('error', 'no_id_token')

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return respond('error', 'bad_id_token')
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
    return respond('error', `token_${tokenRes.status}`)
  }

  const data = await tokenRes.json()
  await saveCanvaTokens(uid, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  return respond('connected')
}
