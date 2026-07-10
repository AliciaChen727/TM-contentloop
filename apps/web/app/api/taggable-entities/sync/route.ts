export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth/access'
import { syncTaggableEntities } from '@/lib/tagging/server'

function bearer(req: NextRequest): string | undefined {
  return req.headers.get('Authorization')?.replace('Bearer ', '')
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { pageId?: string }
  const pageId = body.pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const auth = await requireCapability(bearer(req), pageId, 'content.draft')
  if (!auth.ok) return auth.res
  const result = await syncTaggableEntities(pageId, auth.uid)
  return NextResponse.json(result)
}
