import { adminDb } from '@/lib/firebase/admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'

/**
 * Detects Meta Graph API errors that mean the stored Page access token is no
 * longer usable and the admin MUST re-authorize (re-run OAuth) to mint a fresh
 * one. These are all OAuthException variants — retrying with the SAME token will
 * never succeed, so the only fix is "reconnect", not "try again later".
 *
 * Seen in the wild (Chill Hi High, 2026-07): the token silently stopped working
 * after the user's authorization lapsed →
 *   { code: 200, type: 'OAuthException',
 *     message: 'Cannot call API for app … on behalf of user …' }
 * Every sync since then failed, but the failure was swallowed client-side and
 * the dashboard kept showing stale data with no hint that reconnect was needed.
 */
export interface MetaError { code?: number; error_subcode?: number; type?: string; message?: string }

// OAuthException codes that specifically mean "the user must re-grant access".
const REAUTH_CODES = new Set([102, 190, 200, 10, 458, 459, 460, 463, 467, 492])

export function isReauthRequired(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as MetaError
  if (e.type === 'OAuthException') return true
  return typeof e.code === 'number' && REAUTH_CODES.has(e.code)
}

/**
 * Persist the current validity of a page's stored token onto its metaTokens doc,
 * so the dashboard can surface a "reconnect" banner on load (not only right after
 * a failed sync). `valid: true` clears the invalid markers again after a
 * successful reconnect + sync.
 */
export async function markTokenStatus(uid: string, pageId: string, valid: boolean, message?: string): Promise<void> {
  try {
    const ref = adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId)
    await ref.set(
      valid
        ? { tokenValid: true, tokenInvalidAt: FieldValue.delete(), tokenError: FieldValue.delete() }
        : { tokenValid: false, tokenInvalidAt: Timestamp.now(), tokenError: message ?? '' },
      { merge: true },
    )
  } catch {
    /* best-effort — never let a status write break the sync flow */
  }
}
