// Resolve the pageId whitelist for tool-use agents (Phase 3B, Slice 16).
// Sources mirror /api/pages: (1) pages the user connected via OAuth
// (users/{uid}/metaTokens — always admin), (2) invited pages
// (users/{uid}/viewerAccess/pages — needs ads permission or admin/owner role).
// The result is the ONLY authority tools trust; client/model-supplied pageIds
// outside it are refused at the tool layer.

import { adminDb } from '@/lib/firebase/admin'

export interface AllowedPage {
  pageId: string
  pageName: string
}

export async function resolveAllowedPages(uid: string): Promise<AllowedPage[]> {
  const byId = new Map<string, AllowedPage>()

  // 1) Own OAuth-connected pages (metaTokens doc id = pageId).
  const snap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  for (const d of snap.docs) {
    if (d.id === 'userToken') continue
    const data = d.data()
    if (d.id === 'page') {
      // Legacy single-page doc: pageId lives in a field.
      const pid = typeof data.pageId === 'string' ? data.pageId : null
      if (pid && !byId.has(pid)) byId.set(pid, { pageId: pid, pageName: data.pageName ?? '' })
      continue
    }
    byId.set(d.id, { pageId: d.id, pageName: data.pageName ?? '' })
  }

  // 2) Invited pages with ads access (admin/owner role, or legacy ads permission).
  try {
    const viewerSnap = await adminDb.collection('users').doc(uid).collection('viewerAccess').doc('pages').get()
    const vps: { pageId?: string; pageName?: string; role?: string; permissions?: { ads?: boolean } }[] =
      viewerSnap.data()?.pages ?? []
    for (const vp of vps) {
      if (!vp.pageId || byId.has(vp.pageId)) continue
      const allowed = vp.role === 'admin' || vp.role === 'owner' || vp.permissions?.ads === true
      if (allowed) byId.set(vp.pageId, { pageId: vp.pageId, pageName: vp.pageName ?? '' })
    }
  } catch { /* viewerAccess is optional */ }

  return Array.from(byId.values())
}
