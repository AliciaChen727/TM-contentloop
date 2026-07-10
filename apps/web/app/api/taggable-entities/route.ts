export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth/access'
import { listTaggableEntities, resolveFacebookUserIdentifier, upsertTaggableEntity } from '@/lib/tagging/server'
import type { DraftTarget } from '@/lib/content/draftTypes'
import type { TaggableEntityConfidence, TaggableEntitySource, TaggableEntityType } from '@/lib/tagging/types'

function bearer(req: NextRequest): string | undefined {
  return req.headers.get('Authorization')?.replace('Bearer ', '')
}

function cleanPlatforms(v: unknown): DraftTarget[] {
  if (!Array.isArray(v)) return []
  return Array.from(new Set(v.filter((p): p is DraftTarget => p === 'fb' || p === 'ig' || p === 'th')))
}

export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get('pageId') ?? ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const auth = await requireCapability(bearer(req), pageId, 'content.draft')
  if (!auth.ok) return auth.res
  const entities = await listTaggableEntities(pageId)
  return NextResponse.json({ entities })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    pageId?: string
    type?: TaggableEntityType
    displayName?: string
    fbUserId?: string
    fbPageId?: string
    igUsername?: string
    locationId?: string
    enabledPlatforms?: DraftTarget[]
    source?: TaggableEntitySource
    confidence?: TaggableEntityConfidence
  }
  const pageId = body.pageId ?? ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const auth = await requireCapability(bearer(req), pageId, 'content.draft')
  if (!auth.ok) return auth.res
  if (!['person', 'page', 'location'].includes(body.type ?? '')) return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  const enabledPlatforms = cleanPlatforms(body.enabledPlatforms)
  if (enabledPlatforms.length === 0) return NextResponse.json({ error: 'enabledPlatforms required' }, { status: 400 })
  const wantsFbPerson = body.type === 'person' && enabledPlatforms.includes('fb')
  let displayName = body.displayName?.trim() ?? ''
  let fbUserId = body.fbUserId?.trim().replace(/^@/, '') ?? ''
  if (wantsFbPerson && !fbUserId) return NextResponse.json({ error: 'FB user ID or username required' }, { status: 400 })
  if (body.type === 'page' && enabledPlatforms.includes('fb') && (!body.fbPageId || !/^\d+$/.test(body.fbPageId))) {
    return NextResponse.json({ error: 'FB page tags require a numeric Meta page ID' }, { status: 400 })
  }
  if (wantsFbPerson) {
    const resolved = await resolveFacebookUserIdentifier(pageId, fbUserId)
    if (resolved) {
      fbUserId = resolved.id
      displayName = displayName || resolved.name
    } else if (/^\d+$/.test(fbUserId)) {
      displayName = displayName || `FB User ${fbUserId.slice(-6)}`
    } else {
      return NextResponse.json({
        entity: null,
        unresolved: true,
        error: '找不到這個 FB ID / username，或目前 Page token 沒有權限讀取。請改用數字 Meta User ID。',
      })
    }
  }
  if (!displayName) return NextResponse.json({ error: 'displayName required' }, { status: 400 })
  if (displayName.startsWith('#')) return NextResponse.json({ error: 'hashtags are not taggable people' }, { status: 400 })

  const entity = await upsertTaggableEntity(pageId, {
    type: body.type!,
    displayName,
    fbUserId: fbUserId || undefined,
    fbPageId: body.fbPageId,
    igUsername: body.igUsername,
    locationId: body.locationId,
    enabledPlatforms,
    source: body.source ?? 'manual',
    confidence: body.confidence ?? 'needs_verification',
  }, auth.uid)
  return NextResponse.json({ entity }, { status: 201 })
}
