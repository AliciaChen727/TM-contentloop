export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import nodemailer from 'nodemailer'

interface Permissions { ads: boolean; sidekick: boolean; syncAds: boolean }

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  let inviterName: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
    inviterName = decoded.name ?? decoded.email ?? '管理員'
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { email, pageId, permissions }: { email: string; pageId: string; permissions?: Permissions } = await req.json()
  if (!email || !pageId) return NextResponse.json({ error: 'Missing email or pageId' }, { status: 400 })

  const tokensSnap = await adminDb.collection('users').doc(uid).collection('metaTokens').get()
  const adminPageIds = new Set(tokensSnap.docs.filter(d => d.id !== 'userToken').map(d => d.id === 'page' ? d.data().pageId : d.id).filter(Boolean))
  if (!adminPageIds.has(pageId)) {
    return NextResponse.json({ error: '你不是此粉絲頁的管理員' }, { status: 403 })
  }

  const pageDoc = tokensSnap.docs.find(d => d.id === pageId) ?? tokensSnap.docs.find(d => d.id === 'page')
  const pageData = pageDoc?.data() ?? {}
  const pageName = pageData.pageName ?? ''

  const finalPermissions: Permissions = permissions ?? { ads: false, sidekick: false, syncAds: false }

  const normalizedEmail = email.toLowerCase().trim()
  const inviteData = {
    role: 'viewer',
    invitedBy: uid,
    pageName,
    igUserId: pageData.igUserId ?? null,
    permissions: finalPermissions,
    createdAt: new Date(),
    status: 'pending',
  }

  const batch = adminDb.batch()
  batch.set(adminDb.collection('invites').doc(normalizedEmail).collection('pages').doc(pageId), inviteData)
  // Mirror in pages/{pageId}/pendingInvites for easy admin listing
  batch.set(adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(normalizedEmail), {
    email: normalizedEmail, permissions: finalPermissions, invitedBy: uid, createdAt: new Date(),
  })
  await batch.commit()

  // Send invitation email
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://tm-contentloop.vercel.app'}/auth/login?invited=1`
  const permLabels = [
    finalPermissions.ads && '廣告儀表板',
    finalPermissions.sidekick && 'AI Sidekick',
    finalPermissions.syncAds && '同步廣告資料',
  ].filter(Boolean)
  const permText = permLabels.length > 0 ? permLabels.join('、') : '貼文成效首頁'

  let emailError: string | null = null
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      })
      await transporter.sendMail({
        from: `ContentLoop <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `${inviterName} 邀請你加入 ContentLoop`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
            <h2 style="margin:0 0 8px;font-size:20px;color:#111827">你收到一份邀請</h2>
            <p style="color:#6B7280;font-size:14px;margin:0 0 20px">
              <strong style="color:#111827">${inviterName}</strong> 邀請你加入 ContentLoop，
              查看 <strong>${pageName}</strong> 的成效數據。
            </p>
            <div style="background:white;border-radius:8px;padding:16px;margin-bottom:24px;border:1px solid #E5E7EB">
              <p style="font-size:12px;color:#6B7280;margin:0 0 8px;font-weight:600">開放權限</p>
              <p style="font-size:14px;color:#374151;margin:0">${permText}</p>
            </div>
            <a href="${loginUrl}" style="display:inline-block;background:#3B6FD4;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
              點擊登入 ContentLoop
            </a>
            <p style="font-size:11px;color:#9CA3AF;margin-top:24px">
              使用你的 Google 帳號登入即可存取。
            </p>
          </div>
        `,
      })
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err)
      console.error('[invite] email send failed:', emailError)
    }
  }

  return NextResponse.json({ success: true, emailError })
}
