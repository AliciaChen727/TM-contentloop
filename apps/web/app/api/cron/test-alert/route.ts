export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin, resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { sendAlertEmail } from '@/lib/alerts/emailSender'

// Temporary superadmin-only endpoint to force-send a test alert email.
// Bypasses dedup and detection — sends a fake alert directly.
// DELETE this file after testing.
export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  if (!isSuperAdmin(uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { pageId } = await req.json() as { pageId: string }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  const profile = (await adminDb.collection('pages').doc(pageId).get()).data() ?? {}
  const pageName = profile.pageName ?? profile.brandName ?? pageId

  // Resolve recipients (same logic as processAlerts)
  let recipients: string[] = profile.alertEmails ?? []
  if (recipients.length === 0 && profile.alertEmail) recipients = [profile.alertEmail]
  if (recipients.length === 0) {
    const ownerUid = await resolvePageOwnerUid(pageId)
    if (ownerUid) {
      try {
        const email = (await adminAuth.getUser(ownerUid)).email ?? ''
        if (email) recipients = [email]
      } catch { /* ignore */ }
    }
  }

  if (recipients.length === 0) return NextResponse.json({ ok: false, reason: 'no recipient email resolved' })

  const fakeAlerts = [
    { key: 'test_ctr_drop', type: 'ctr_drop' as const, message: '【測試】CTR 下滑超過 30%，請檢查廣告素材是否需要更新。' },
    { key: 'test_cpc_spike', type: 'cpc_spike' as const, message: '【測試】CPC 飆升超過 50%，建議檢視競價策略。' },
  ]

  const results = await Promise.all(recipients.map(to => sendAlertEmail(to, `${pageName}（測試）`, fakeAlerts)))

  return NextResponse.json({ ok: true, pageName, recipients, results })
}
