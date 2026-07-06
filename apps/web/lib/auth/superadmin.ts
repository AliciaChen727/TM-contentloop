import { adminDb } from '@/lib/firebase/admin'

/**
 * Super-admin override (server-side only).
 *
 * UIDs listed in the SUPER_ADMIN_UIDS env var (comma-separated) bypass the
 * normal page-scoped permission checks and may view ANY page's dashboard data.
 *
 * ⚠️ This deliberately crosses the page-isolation boundary described in CLAUDE.md.
 * It is a read-level god-mode for the product owner only — keep the env var secret
 * and never expose it to the client. Every super-admin code path must be gated by
 * isSuperAdmin(uid) AFTER the Firebase ID token has been verified.
 */
export function isSuperAdmin(uid: string): boolean {
  return (process.env.SUPER_ADMIN_UIDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .includes(uid)
}

/**
 * Resolve the uid under which a page's per-owner data is stored
 * (FB/IG posts live at users/{ownerUid}/pages/{pageId}/...).
 * Prefers the explicit owner; falls back to the earliest-added admin.
 */
export async function resolvePageOwnerUid(pageId: string): Promise<string | null> {
  const ownerSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
    .where('isOwner', '==', true).limit(1).get()
  if (!ownerSnap.empty) return ownerSnap.docs[0].id

  const earliestSnap = await adminDb.collection('pages').doc(pageId).collection('admins')
    .orderBy('addedAt', 'asc').limit(1).get()
  if (!earliestSnap.empty) return earliestSnap.docs[0].id

  // Legacy fallback: pages connected before the admins-registration flow existed
  // have NO pages/{pageId}/admins subcollection — the only record of the owner is
  // their metaTokens/{pageId} doc (which carries a `pageId` field). Resolve the
  // data owner directly from there so super-admins/viewers still see the data.
  const tokSnap = await adminDb.collectionGroup('metaTokens')
    .where('pageId', '==', pageId).limit(1).get()
  return tokSnap.empty ? null : (tokSnap.docs[0].ref.parent.parent?.id ?? null)
}

export interface SuperAdminPage { pageId: string; pageName: string; igUserId: string | null }

/**
 * List every page registered in the system, with name/igUserId pulled from the
 * owner's metaTokens. Top-level pages/{pageId} docs are often phantom (only the
 * `admins` subcollection exists), so we enumerate via listDocuments().
 */
export async function listAllPages(): Promise<SuperAdminPage[]> {
  const pageRefs = await adminDb.collection('pages').listDocuments()
  const results = await Promise.all(pageRefs.map(async ref => {
    const pageId = ref.id
    const ownerUid = await resolvePageOwnerUid(pageId)
    let pageName = pageId
    let igUserId: string | null = null
    if (ownerUid) {
      const tok = await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
      if (tok.exists) {
        pageName = tok.data()?.pageName ?? pageId
        igUserId = tok.data()?.igUserId ?? null
      }
    }
    return { pageId, pageName, igUserId }
  }))
  return results
}
