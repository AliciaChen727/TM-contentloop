// Server-side content (post) diagnosis for the alert cron → email/bell. Loads
// page-scoped FB/IG posts under the page owner and runs the same Layer-1 rules as
// the dashboard (contentDiagnosis.ts), so the email can include post suggestions,
// not just ads.
//
// ISOLATION (CLAUDE.md): all reads are page-scoped. FB legacy fallback is filtered
// by the `${pageId}_` doc-id prefix; IG has no page prefix so legacy is NOT read
// at all when pageId is known. hasAd uses the snapshot's adPostIds/igPostIds.

import { adminDb } from '@/lib/firebase/admin'
import type { DiagItem, Post } from '@/components/ads/types'
import { buildContentDiagnosis } from '@/lib/ads/contentDiagnosis'
import { belongsToAnyPrefix } from '@/lib/meta/pageIsolation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDateStr(v: any): string {
  if (!v) return ''
  if (typeof v === 'string') return v.slice(0, 10)
  if (typeof v?.toDate === 'function') return v.toDate().toISOString().slice(0, 10)
  return ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFbDoc(id: string, d: any, adPostIds: Set<string>): Post {
  const shortId = id.includes('_') ? id.split('_').slice(1).join('_') : id
  const ins = d.insights ?? {}
  const hasAd = adPostIds.has(shortId) || adPostIds.has(id) || (ins.paidReach ?? 0) > 0
  return {
    id, date: toDateStr(d.createdTime), platform: 'FB', title: d.message || '（無文字內容）',
    reach: (ins.reach ?? 0) > 0 ? ins.reach : null,
    likes: ins.reactions ?? 0, comments: ins.comments ?? 0, saves: null, shares: ins.shares ?? 0,
    plays: null, type: 'post', url: d.permalink || '#', hasAd,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIgDoc(id: string, d: any, igPostIds: Set<string>): Post {
  const ins = d.insights ?? {}
  const isVideo = d.mediaType === 'REELS' || d.mediaType === 'VIDEO'
  return {
    id, date: toDateStr(d.timestamp), platform: 'IG', title: d.caption || '（無文字內容）',
    reach: ins.reach ?? 0, likes: ins.likes ?? 0, comments: ins.comments ?? 0,
    saves: ins.saved ?? 0, shares: ins.shares ?? 0,
    plays: isVideo && (ins.views ?? 0) > 0 ? ins.views : null,
    type: isVideo ? 'reels' : 'post', url: d.permalink || '#', hasAd: igPostIds.has(id),
  }
}

// Load page-scoped posts for the owner and return content DiagItems. Returns []
// on any read failure — content diagnosis is best-effort, never blocks alerts.
export async function loadContentDiagnosis(
  ownerUid: string, pageId: string, adPostIds: string[], igPostIds: string[],
  summary?: { cpm?: number }, en = false,
): Promise<DiagItem[]> {
  try {
    const userRef = adminDb.collection('users').doc(ownerUid)
    const [fbNew, fbLegacy, igSnap] = await Promise.all([
      userRef.collection('pages').doc(pageId).collection('fbPosts').get(),
      userRef.collection('fbPosts').get(),
      userRef.collection('pages').doc(pageId).collection('igPosts').get(),
    ])

    const adIds = new Set(adPostIds)
    const igIds = new Set(igPostIds)

    // FB: page-scoped docs are canonical; merge legacy ONLY for this page's prefix.
    const fbById = new Map<string, Post>()
    for (const doc of fbNew.docs) fbById.set(doc.id, mapFbDoc(doc.id, doc.data(), adIds))
    for (const doc of fbLegacy.docs) {
      if (!belongsToAnyPrefix(doc.id, [pageId])) continue   // ISOLATION: never another page
      if (!fbById.has(doc.id)) fbById.set(doc.id, mapFbDoc(doc.id, doc.data(), adIds))
    }

    // IG: page-scoped only (no legacy when pageId is known).
    const igPosts = igSnap.docs.map((doc) => mapIgDoc(doc.id, doc.data(), igIds))

    const posts: Post[] = [...Array.from(fbById.values()), ...igPosts]
      .filter((p) => p.title && p.title !== '（無文字內容）')

    return buildContentDiagnosis(posts, summary, en)
  } catch {
    return []
  }
}
