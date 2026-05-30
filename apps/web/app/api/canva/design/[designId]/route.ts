export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { canvaFetch } from '@/lib/canva/client'

async function verifyUser(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}

function extractText(element: Record<string, unknown>): string[] {
  const texts: string[] = []
  if (element.type === 'text' && typeof element.text === 'string' && element.text.trim()) {
    texts.push(element.text.trim())
  }
  const children = element.children as Record<string, unknown>[] | undefined
  if (Array.isArray(children)) {
    for (const child of children) texts.push(...extractText(child))
  }
  return texts
}

export async function GET(
  req: NextRequest,
  { params }: { params: { designId: string } },
) {
  const uid = await verifyUser(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { designId } = params

  let designRes: Response, pagesRes: Response
  try {
    [designRes, pagesRes] = await Promise.all([
      canvaFetch(uid, `/designs/${designId}`),
      canvaFetch(uid, `/designs/${designId}/pages`),
    ])
  } catch (e) {
    // getValidAccessToken throws when there's no stored token or refresh failed.
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[canva/design] token error for uid=${uid}: ${msg}`)
    return NextResponse.json({ error: 'CANVA_NOT_CONNECTED', detail: msg }, { status: 401 })
  }

  if (!designRes.ok) {
    const detail = await designRes.text().catch(() => '')
    console.error(`[canva/design] designId=${designId} canva status=${designRes.status} body=${detail.slice(0, 300)}`)
    if (designRes.status === 401 || designRes.status === 403) {
      // 401/403 here means Canva rejected the read: either the token can't be
      // refreshed, or this design isn't owned by / shared with the connected account.
      return NextResponse.json({ error: 'CANVA_DESIGN_FORBIDDEN', canvaStatus: designRes.status }, { status: 403 })
    }
    return NextResponse.json({ error: 'Design not found', canvaStatus: designRes.status }, { status: 404 })
  }

  const { design } = await designRes.json()
  const editUrl = `https://www.canva.com/design/${designId}/edit`

  if (!pagesRes.ok) {
    return NextResponse.json({ title: design.title ?? '', textContent: [], editUrl })
  }

  const { pages } = await pagesRes.json()
  const textContent: string[] = []
  for (const page of pages ?? []) {
    const elements = page.elements as Record<string, unknown>[] | undefined
    if (Array.isArray(elements)) {
      for (const el of elements) textContent.push(...extractText(el))
    }
  }

  return NextResponse.json({
    title: design.title ?? '',
    textContent: textContent.filter((t, i) => textContent.indexOf(t) === i),
    editUrl,
  })
}
