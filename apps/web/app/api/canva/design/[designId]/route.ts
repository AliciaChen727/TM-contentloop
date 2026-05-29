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

  const [designRes, pagesRes] = await Promise.all([
    canvaFetch(uid, `/designs/${designId}`),
    canvaFetch(uid, `/designs/${designId}/pages`),
  ])

  if (!designRes.ok) {
    if (designRes.status === 401 || designRes.status === 403) {
      return NextResponse.json({ error: 'CANVA_NOT_CONNECTED' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Design not found' }, { status: 404 })
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
