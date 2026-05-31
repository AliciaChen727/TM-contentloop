export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import type { Timestamp } from 'firebase-admin/firestore'

// GET /api/notifications
// Returns the current user's notifications (most recent first, limit 20) plus
// the unread count. Per-user collection → auth is just the caller's own token.
// See docs/phase-2-notification-center.md.

async function authUid(req: NextRequest): Promise<string | null> {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return null
  try { return (await adminAuth.verifyIdToken(idToken)).uid } catch { return null }
}

function toMillis(v: unknown): number | null {
  if (v && typeof (v as Timestamp).toMillis === 'function') return (v as Timestamp).toMillis()
  return null
}

export async function GET(req: NextRequest) {
  const uid = await authUid(req)
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const col = adminDb.collection('users').doc(uid).collection('notifications')
  const [itemsSnap, unreadSnap] = await Promise.all([
    col.orderBy('createdAt', 'desc').limit(20).get(),
    col.where('read', '==', false).limit(100).get(),
  ])

  const items = itemsSnap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      type: data.type ?? 'system',
      pageId: data.pageId ?? '',
      pageName: data.pageName ?? '',
      title: data.title ?? '',
      body: data.body ?? '',
      advice: data.advice ?? '',
      actionPrompt: data.actionPrompt ?? null,
      deepLink: data.deepLink ?? '/dashboard',
      read: data.read === true,
      createdAt: toMillis(data.createdAt),
    }
  })

  return NextResponse.json({ items, unreadCount: unreadSnap.size })
}
