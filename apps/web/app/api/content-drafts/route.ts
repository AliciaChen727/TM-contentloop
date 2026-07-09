/**
 * Content drafts — create + list (Agent 自動發布 S1). BFF: Bearer + page access.
 * Drafts are the human-in-the-loop gate: Agent output is saved here as `draft`
 * and never published until an Admin approves. Page-scoped + isolated.
 * See docs/agent-auto-publish-plan.md.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { can } from '@/lib/auth/access'
import { createDraft, listDrafts, writeAudit } from '@/lib/content/draftStore'
import { isValidTarget, isValidMediaType, type DraftStatus, type CreateDraftInput, type DraftTarget } from '@/lib/content/draftTypes'
import { validateItems, hasBlockingErrors } from '@/lib/publish/validateDraft'
import { hasPageThreadsConnection } from '@/lib/threads/client'

async function uidFromReq(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

// Drafts are unpublished content → editor+ may see/create/edit drafts; publishing
// remains admin+ in the publish route.
async function canManage(uid: string, pageId: string): Promise<boolean> {
  return can(uid, pageId, 'content.draft')
}

// GET ?pageId=&status=&limit= → { drafts }
export async function GET(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = (req.nextUrl.searchParams.get('status') ?? undefined) as DraftStatus | undefined
  const limitRaw = req.nextUrl.searchParams.get('limit')
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 100) : 50
  const drafts = await listDrafts(pageId, { status, limit })
  return NextResponse.json({ drafts })
}

// POST { pageId, target[], mediaType, generated, schedule? } → { draft } (status draft)
export async function POST(req: NextRequest) {
  const uid = await uidFromReq(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Partial<CreateDraftInput>
  const { pageId, target, mediaType, generated, schedule } = body
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Validate shape (S3 will add字數/尺寸 hard limits; here just structural).
  if (!Array.isArray(target) || target.length === 0 || !target.every(isValidTarget)) {
    return NextResponse.json({ error: 'target must be a non-empty array of fb|ig|th' }, { status: 400 })
  }
  if (target.includes('th') && !(await hasPageThreadsConnection(pageId))) {
    return NextResponse.json({ error: '請先建立 Threads 並連結帳號，才能建立或發布 Threads 草稿' }, { status: 409 })
  }
  if (!isValidMediaType(mediaType)) {
    return NextResponse.json({ error: 'invalid mediaType' }, { status: 400 })
  }
  if (!generated || typeof generated !== 'object' || typeof generated.perPlatform !== 'object') {
    return NextResponse.json({ error: 'generated.perPlatform required' }, { status: 400 })
  }
  // Every targeted platform must have adapted copy.
  for (const t of target) {
    if (!generated.perPlatform[t]) return NextResponse.json({ error: `missing generated.perPlatform.${t}` }, { status: 400 })
  }

  // Server-side platform validation (defense in depth — never trust the client).
  const items = target.map((t: DraftTarget) => {
    const pp = generated.perPlatform[t]!
    return { platform: t, text: pp.body ?? '', hashtags: pp.hashtags ?? [], hasMedia: !!(pp.mediaUrl ?? generated.mediaUrl), mediaType }
  })
  const violations = validateItems(items)
  if (hasBlockingErrors(violations)) {
    return NextResponse.json({ error: 'validation failed', violations: violations.filter(v => v.severity === 'error') }, { status: 422 })
  }

  const draft = await createDraft({ pageId, target, mediaType, generated, schedule }, uid)
  await writeAudit(pageId, draft.id, 'create', uid, { target, mediaType })
  return NextResponse.json({ draft }, { status: 201 })
}
