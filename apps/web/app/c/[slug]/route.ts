// Conversion landing: /c/{slug} is where a registration form redirects AFTER
// submit. We tie the completion back to the click (via the first-party cookie
// set in /r, or a ?cl_id param the form carried), record it, then send the user
// on to a thank-you page (or show a minimal confirmation). Node runtime.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { recordConversion } from '@/lib/links/server'

const HOME = 'https://tm-contentloop.vercel.app/'

function confirmHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>✅</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc">
<div style="text-align:center;padding:24px"><div style="font-size:48px">✅</div>
<p style="font-size:18px;color:#1f2937;font-weight:600">報名完成 · Registration recorded</p>
<p style="font-size:13px;color:#9ca3af">你可以關閉這個分頁 · You may close this tab</p></div></body></html>`
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug
  try {
    const linkSnap = await adminDb.collection('shortLinks').doc(slug).get()
    const link = linkSnap.data()
    if (linkSnap.exists && link) {
      const pageId = link.pageId as string
      const clickId = req.cookies.get(`cl_${slug}`)?.value ?? req.nextUrl.searchParams.get('cl_id')
      await recordConversion(pageId, slug, clickId || null, 'redirect')

      const thankYouUrl = link.thankYouUrl as string | undefined
      const res = thankYouUrl
        ? NextResponse.redirect(thankYouUrl, 302)
        : new NextResponse(confirmHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
      res.cookies.delete(`cl_${slug}`)
      return res
    }
  } catch { /* fall through */ }
  return NextResponse.redirect(HOME, 302)
}
