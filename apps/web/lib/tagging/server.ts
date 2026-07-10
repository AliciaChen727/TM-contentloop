import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import type { DraftTarget } from '@/lib/content/draftTypes'
import type {
  ResolvedPublishTagging,
  TaggableEntity,
  TaggableEntityConfidence,
  TaggableEntitySource,
  TaggableEntityType,
  TaggingSelection,
} from './types'

type EntityInput = Omit<TaggableEntity, 'id' | 'pageId' | 'createdAt' | 'updatedAt'>

const collection = (pageId: string) =>
  adminDb.collection('pages').doc(pageId).collection('taggableEntities')

function toMillis(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis()
  return undefined
}

function cleanPlatforms(platforms: unknown): DraftTarget[] {
  if (!Array.isArray(platforms)) return []
  return Array.from(new Set(platforms.filter((p): p is DraftTarget => p === 'fb' || p === 'ig' || p === 'th')))
}

function fromDoc(pageId: string, id: string, d: FirebaseFirestore.DocumentData): TaggableEntity {
  return {
    id,
    pageId,
    type: (d.type ?? 'person') as TaggableEntityType,
    displayName: String(d.displayName ?? id),
    fbUserId: d.fbUserId ? String(d.fbUserId) : undefined,
    fbPageId: d.fbPageId ? String(d.fbPageId) : undefined,
    igUsername: d.igUsername ? String(d.igUsername) : undefined,
    locationId: d.locationId ? String(d.locationId) : undefined,
    enabledPlatforms: cleanPlatforms(d.enabledPlatforms),
    source: (d.source ?? 'manual') as TaggableEntitySource,
    confidence: (d.confidence ?? 'needs_verification') as TaggableEntityConfidence,
    disabled: d.disabled === true,
    createdBy: d.createdBy ? String(d.createdBy) : undefined,
    lastSeenAt: toMillis(d.lastSeenAt) ?? d.lastSeenAt,
    createdAt: toMillis(d.createdAt) ?? d.createdAt,
    updatedAt: toMillis(d.updatedAt) ?? d.updatedAt ?? 0,
  }
}

function entityDocId(e: Pick<EntityInput, 'type' | 'displayName' | 'fbUserId' | 'fbPageId' | 'igUsername' | 'locationId'>): string {
  const key = [
    e.type,
    e.fbUserId ?? '',
    e.fbPageId ?? '',
    e.igUsername?.toLowerCase() ?? '',
    e.locationId ?? '',
    e.displayName.toLowerCase(),
  ].join('|')
  return createHash('sha1').update(key).digest('hex').slice(0, 20)
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

export async function listTaggableEntities(pageId: string): Promise<TaggableEntity[]> {
  const snap = await collection(pageId).orderBy('displayName', 'asc').limit(500).get()
  return snap.docs.map(d => fromDoc(pageId, d.id, d.data())).filter(e => !e.disabled)
}

export async function upsertTaggableEntity(pageId: string, input: EntityInput, byUid: string): Promise<TaggableEntity> {
  const id = entityDocId(input)
  const now = Date.now()
  const ref = collection(pageId).doc(id)
  const existing = await ref.get()
  const platforms = cleanPlatforms(input.enabledPlatforms)
  const patch = compact({
    type: input.type,
    displayName: input.displayName.trim(),
    fbUserId: input.fbUserId,
    fbPageId: input.fbPageId,
    igUsername: input.igUsername?.replace(/^@/, '').trim(),
    locationId: input.locationId,
    enabledPlatforms: platforms,
    source: input.source,
    confidence: input.confidence,
    disabled: input.disabled,
    createdBy: existing.exists ? existing.data()?.createdBy : byUid,
    createdAt: existing.exists ? existing.data()?.createdAt : now,
    updatedAt: now,
    lastSeenAt: input.lastSeenAt ?? now,
  })
  await ref.set(patch, { merge: true })
  const doc = await ref.get()
  return fromDoc(pageId, id, doc.data() as FirebaseFirestore.DocumentData)
}

function addIgMentions(candidates: EntityInput[], text: unknown) {
  if (typeof text !== 'string') return
  const seen = new Set(candidates.filter(c => c.igUsername).map(c => c.igUsername!.toLowerCase()))
  const rx = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9_.]{2,30})/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(text)) !== null) {
    const username = m[2].toLowerCase()
    if (seen.has(username)) continue
    seen.add(username)
    candidates.push({
      type: 'person',
      displayName: `@${username}`,
      igUsername: username,
      enabledPlatforms: ['ig'],
      source: 'ig_caption',
      confidence: 'ready',
    })
  }
}

function addFbBracketMentions(candidates: EntityInput[], text: unknown) {
  if (typeof text !== 'string') return
  const seen = new Set(candidates.filter(c => c.fbPageId).map(c => c.fbPageId!))
  const rx = /@\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(text)) !== null) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    candidates.push({
      type: 'page',
      displayName: `Facebook Page ${id}`,
      fbPageId: id,
      enabledPlatforms: ['fb'],
      source: 'historical_post_tag',
      confidence: 'needs_verification',
    })
  }
}

function addFbMessageTags(candidates: EntityInput[], value: unknown) {
  const tags = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value as Record<string, unknown>).flat()
      : []
  for (const raw of tags) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as { id?: unknown; name?: unknown; type?: unknown }
    const id = t.id ? String(t.id) : ''
    const name = t.name ? String(t.name) : id
    if (!id || !name) continue
    if (id.startsWith('#') || name.trim().startsWith('#')) continue
    const isPage = String(t.type ?? '').toLowerCase().includes('page')
    candidates.push({
      type: isPage ? 'page' : 'person',
      displayName: name,
      ...(isPage ? { fbPageId: id } : { fbUserId: id }),
      enabledPlatforms: ['fb'],
      source: 'historical_post_tag',
      confidence: 'ready',
    })
  }
}

function addFbCommenters(candidates: EntityInput[], value: unknown) {
  const comments = value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
    ? (value as { data: unknown[] }).data
    : []
  for (const raw of comments) {
    if (!raw || typeof raw !== 'object') continue
    const from = (raw as { from?: unknown }).from
    if (!from || typeof from !== 'object') continue
    const f = from as { id?: unknown; name?: unknown }
    const id = f.id ? String(f.id) : ''
    const name = f.name ? String(f.name) : id
    if (!id || !name) continue
    if (id.startsWith('#') || name.trim().startsWith('#')) continue
    candidates.push({
      type: 'person',
      displayName: name,
      fbUserId: id,
      enabledPlatforms: ['fb'],
      source: 'commenter',
      confidence: 'needs_verification',
    })
  }
}

function addFbPlace(candidates: EntityInput[], place: unknown) {
  if (!place || typeof place !== 'object') return
  const p = place as { id?: unknown; name?: unknown }
  const id = p.id ? String(p.id) : ''
  if (!id) return
  candidates.push({
    type: 'location',
    displayName: p.name ? String(p.name) : `Location ${id}`,
    locationId: id,
    enabledPlatforms: ['fb', 'ig'],
    source: 'post_place',
    confidence: 'ready',
  })
}

async function getPageAccessToken(pageId: string, ownerUid: string): Promise<string | null> {
  const tok = await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
  const token = tok.data()?.accessToken
  return typeof token === 'string' && token ? token : null
}

async function graphGet(path: string, params: Record<string, string>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${qs.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) return { ok: false, error: data.error?.message ?? `Graph ${res.status}` }
  return { ok: true, data }
}

export async function resolveFacebookUserIdentifier(pageId: string, identifier: string): Promise<{ id: string; name: string } | null> {
  const cleanIdentifier = identifier.trim().replace(/^@/, '')
  if (!cleanIdentifier || cleanIdentifier.startsWith('#')) return null
  const owner = await resolvePageOwnerUid(pageId)
  if (!owner) {
    console.warn('[taggable-entities] FB identifier resolve skipped: no page owner', { pageId, identifier: cleanIdentifier })
    return null
  }
  const token = await getPageAccessToken(pageId, owner)
  if (!token) {
    console.warn('[taggable-entities] FB identifier resolve skipped: no page token', { pageId, identifier: cleanIdentifier })
    return null
  }
  console.info('[taggable-entities] FB identifier resolve attempt', { pageId, identifier: cleanIdentifier, numeric: /^\d+$/.test(cleanIdentifier) })
  const r = await graphGet(encodeURIComponent(cleanIdentifier), { access_token: token, fields: 'id,name' })
  if (!r.ok || !r.data || typeof r.data !== 'object') {
    console.warn('[taggable-entities] FB identifier resolve failed', { pageId, identifier: cleanIdentifier, error: r.ok ? 'invalid response' : r.error })
    return null
  }
  const data = r.data as { id?: unknown; name?: unknown }
  const id = data.id ? String(data.id) : ''
  const name = data.name ? String(data.name) : ''
  if (!id || !name) console.warn('[taggable-entities] FB identifier resolve incomplete', { pageId, identifier: cleanIdentifier, hasId: Boolean(id), hasName: Boolean(name) })
  return id && name ? { id, name } : null
}

async function fetchFbGraphTagCandidates(pageId: string, ownerUid: string): Promise<EntityInput[]> {
  const token = await getPageAccessToken(pageId, ownerUid)
  if (!token) return []
  const fieldSets = [
    'id,message,message_tags,place,tags.limit(100){id,name},comments.limit(100){from}',
    'id,message,message_tags,place,comments.limit(100){from}',
    'id,message,place,comments.limit(100){from}',
    'id,message,place',
  ]
  let posts: unknown[] = []
  for (const fields of fieldSets) {
    const r = await graphGet(`${pageId}/posts`, { access_token: token, limit: '100', fields })
    if (r.ok) {
      posts = Array.isArray((r.data as { data?: unknown }).data) ? (r.data as { data: unknown[] }).data : []
      break
    }
  }
  const candidates: EntityInput[] = []
  for (const raw of posts) {
    if (!raw || typeof raw !== 'object') continue
    const post = raw as Record<string, unknown>
    addFbBracketMentions(candidates, post.message)
    addFbMessageTags(candidates, post.message_tags ?? post.messageTags ?? post.tags)
    addFbPlace(candidates, post.place)
    addFbCommenters(candidates, post.comments)
  }
  return candidates
}

export async function syncTaggableEntities(pageId: string, byUid: string): Promise<{ entities: TaggableEntity[]; scanned: number }> {
  const owner = await resolvePageOwnerUid(pageId)
  if (!owner) return { entities: await listTaggableEntities(pageId), scanned: 0 }

  const [fbSnap, igSnap] = await Promise.all([
    adminDb.collection('users').doc(owner).collection('pages').doc(pageId).collection('fbPosts').orderBy('createdTime', 'desc').limit(200).get().catch(() => null),
    adminDb.collection('users').doc(owner).collection('pages').doc(pageId).collection('igPosts').orderBy('timestamp', 'desc').limit(200).get().catch(() => null),
  ])

  const candidates: EntityInput[] = []
  fbSnap?.docs.forEach(doc => {
    const d = doc.data()
    addFbBracketMentions(candidates, d.message)
    addFbBracketMentions(candidates, d.story)
    addFbMessageTags(candidates, d.message_tags ?? d.messageTags ?? d.tags)
    addFbPlace(candidates, d.place)
  })
  igSnap?.docs.forEach(doc => {
    const d = doc.data()
    addIgMentions(candidates, d.caption ?? d.message)
    addFbPlace(candidates, d.location)
  })
  candidates.push(...await fetchFbGraphTagCandidates(pageId, owner).catch(() => []))

  const upserted: TaggableEntity[] = []
  const keys = new Set<string>()
  for (const c of candidates) {
    const key = entityDocId(c)
    if (keys.has(key)) continue
    keys.add(key)
    upserted.push(await upsertTaggableEntity(pageId, c, byUid))
  }
  const entities = await listTaggableEntities(pageId)
  return { entities, scanned: (fbSnap?.size ?? 0) + (igSnap?.size ?? 0) }
}

async function selectedEntities(pageId: string, ids: string[]): Promise<Map<string, TaggableEntity>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  const out = new Map<string, TaggableEntity>()
  await Promise.all(uniq.map(async id => {
    const d = await collection(pageId).doc(id).get()
    if (d.exists) out.set(id, fromDoc(pageId, id, d.data() as FirebaseFirestore.DocumentData))
  }))
  return out
}

function needsPlatform(target: DraftTarget[], platform: DraftTarget, hasSelection: boolean): string | null {
  return hasSelection && !target.includes(platform) ? `${platform} tagging selected but platform is not targeted` : null
}

export async function validateTaggingSelection(
  pageId: string,
  target: DraftTarget[],
  tagging?: TaggingSelection,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!tagging) return { ok: true }
  const ids = [
    ...(tagging.fb?.personTags ?? []),
    tagging.fb?.place,
    ...(tagging.ig?.mentions ?? []),
    tagging.ig?.location,
    tagging.th?.location,
  ].filter((v): v is string => !!v)
  if (ids.length === 0) return { ok: true }
  const platformError =
    needsPlatform(target, 'fb', !!tagging.fb && ids.some(id => [...(tagging.fb?.personTags ?? []), tagging.fb?.place].includes(id))) ??
    needsPlatform(target, 'ig', !!tagging.ig && ids.some(id => [...(tagging.ig?.mentions ?? []), tagging.ig?.location].includes(id))) ??
    needsPlatform(target, 'th', !!tagging.th && ids.some(id => [tagging.th?.location].includes(id)))
  if (platformError) return { ok: false, error: platformError }

  const entities = await selectedEntities(pageId, ids)
  for (const id of ids) {
    const e = entities.get(id)
    if (!e || e.disabled) return { ok: false, error: `標記名單不存在或已停用：${id}` }
  }
  const check = (id: string, platform: DraftTarget, pred: (e: TaggableEntity) => boolean, label: string) => {
    const e = entities.get(id)
    return e && e.enabledPlatforms.includes(platform) && pred(e) ? null : `${label} 不符合 ${platform} 發布需求`
  }
  for (const id of tagging.fb?.personTags ?? []) {
    const err = check(id, 'fb', e => e.type === 'person' && e.confidence === 'ready', 'FB 插入姓名')
    if (err) return { ok: false, error: err }
  }
  if (tagging.fb?.place) {
    const err = check(tagging.fb.place, 'fb', e => e.type === 'location' && !!e.locationId, 'FB 地點')
    if (err) return { ok: false, error: err }
  }
  for (const id of tagging.ig?.mentions ?? []) {
    const err = check(id, 'ig', e => e.type === 'person' && !!e.igUsername, 'IG @標記')
    if (err) return { ok: false, error: err }
  }
  if (tagging.ig?.location) {
    const err = check(tagging.ig.location, 'ig', e => e.type === 'location' && !!e.locationId, 'IG 地點')
    if (err) return { ok: false, error: err }
  }
  if (tagging.th?.location) {
    const err = check(tagging.th.location, 'th', e => e.type === 'location' && !!e.locationId, 'Threads 地點')
    if (err) return { ok: false, error: err }
  }
  return { ok: true }
}

export async function resolvePublishTagging(pageId: string, tagging?: TaggingSelection): Promise<ResolvedPublishTagging> {
  if (!tagging) return {}
  const ids = [
    ...(tagging.fb?.personTags ?? []),
    tagging.fb?.place,
    ...(tagging.ig?.mentions ?? []),
    tagging.ig?.location,
    tagging.th?.location,
  ].filter((v): v is string => !!v)
  const entities = await selectedEntities(pageId, ids)
  const get = (id?: string) => id ? entities.get(id) : undefined
  return {
    fb: {
      // Meta Graph API does not reliably create clickable Page/profile links
      // from text placeholders in this Page publishing flow. Keep selected FB
      // pages/people as draft-side name insertion only; only place is sent.
      pageMentionIds: [],
      personTagIds: [],
      placeId: get(tagging.fb?.place)?.locationId,
    },
    ig: {
      usernames: (tagging.ig?.mentions ?? []).map(id => get(id)?.igUsername).filter((v): v is string => !!v),
      locationId: get(tagging.ig?.location)?.locationId,
    },
    th: {
      locationId: get(tagging.th?.location)?.locationId,
    },
  }
}
