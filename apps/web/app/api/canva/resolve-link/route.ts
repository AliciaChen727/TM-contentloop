export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'

const DESIGN_RE = /canva\.com\/design\/(D[A-Za-z0-9_-]{6,})/i

// Restrict server-side fetches to Canva hosts only (avoid SSRF via arbitrary URLs).
function hostAllowed(u: URL): boolean {
  const h = u.hostname.toLowerCase()
  return h === 'canva.link' || h === 'canva.com' || h.endsWith('.canva.com')
}

// Resolves a Canva link (full or short canva.link/...) to a design ID. Short
// links don't contain the ID, so we follow the redirect to the full design URL.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await adminAuth.verifyIdToken(idToken)
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { url } = await req.json().catch(() => ({})) as { url?: string }
  if (!url?.trim()) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  // Fast path: already a full design URL.
  const direct = url.match(DESIGN_RE)
  if (direct) return NextResponse.json({ designId: direct[1] })

  let target: URL
  try {
    target = new URL(url.trim())
  } catch {
    return NextResponse.json({ error: 'INVALID_URL' }, { status: 400 })
  }
  if (!hostAllowed(target)) return NextResponse.json({ error: 'NOT_CANVA_URL' }, { status: 400 })

  try {
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    // res.url is the final URL after redirects (short link → full design URL).
    const fromUrl = res.url.match(DESIGN_RE)
    if (fromUrl) {
      console.log(`[canva/resolve-link] ${url} -> ${res.url} designId=${fromUrl[1]}`)
      return NextResponse.json({ designId: fromUrl[1] })
    }

    // Fallback: some short links land on an HTML page; scan it for the ID.
    const text = await res.text().catch(() => '')
    const fromBody = text.match(DESIGN_RE)
    if (fromBody) {
      console.log(`[canva/resolve-link] ${url} body-matched designId=${fromBody[1]} (finalUrl=${res.url})`)
      return NextResponse.json({ designId: fromBody[1] })
    }

    console.error(`[canva/resolve-link] no design id. status=${res.status} finalUrl=${res.url}`)
    return NextResponse.json({ error: 'NO_DESIGN_ID', finalUrl: res.url }, { status: 422 })
  } catch (e) {
    console.error(`[canva/resolve-link] fetch failed for ${url}: ${e instanceof Error ? e.message : e}`)
    return NextResponse.json({ error: 'RESOLVE_FAILED' }, { status: 502 })
  }
}
