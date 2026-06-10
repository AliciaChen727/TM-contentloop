// Form-platform webhook: Tally / Typeform / Jotform POST here on every submit.
// Most reliable conversion signal (doesn't depend on the user landing on /c).
// Tie-back: the form carries our hidden field `cl_id` (populated from the
// ?cl_id param we appended in /r). Spoofing guard: ?token must match the link's
// conversionToken. Node runtime.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { recordConversion } from '@/lib/links/server'

// Pull a cl_id out of an arbitrary webhook payload (platforms nest it differently).
function findClId(obj: unknown, depth = 0): string | null {
  if (depth > 6 || obj == null) return null
  if (typeof obj === 'string') return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findClId(v, depth + 1); if (r) return r }
    return null
  }
  if (typeof obj === 'object') {
    const rec = obj as Record<string, unknown>
    for (const [k, v] of Object.entries(rec)) {
      if (/^cl_?id$/i.test(k) && typeof v === 'string' && v) return v
      // Tally/Typeform field shape: { key/label: 'cl_id', value: '...' }
      if ((/^(key|label|name|title)$/i.test(k)) && typeof v === 'string' && /^cl_?id$/i.test(v)) {
        const val = rec.value ?? rec.answer
        if (typeof val === 'string' && val) return val
      }
      const r = findClId(v, depth + 1); if (r) return r
    }
  }
  return null
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug
  const token = req.nextUrl.searchParams.get('token') ?? ''
  try {
    const linkSnap = await adminDb.collection('shortLinks').doc(slug).get()
    const link = linkSnap.data()
    if (!linkSnap.exists || !link) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const pageId = link.pageId as string
    // Verify the token against the page-scoped link doc (kept off the public doc).
    const pageLink = (await adminDb.collection('pages').doc(pageId).collection('links').doc(slug).get()).data()
    if (!pageLink || !pageLink.conversionToken || pageLink.conversionToken !== token) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const clId = findClId(body) ?? req.nextUrl.searchParams.get('cl_id')
    await recordConversion(pageId, slug, clId || null, 'webhook')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
