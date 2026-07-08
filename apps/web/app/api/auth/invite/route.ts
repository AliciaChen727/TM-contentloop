export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'
import { can, roleFromLegacyPerms } from '@/lib/auth/access'
import { type Role, isRole, legacyPermsForRole } from '@/lib/auth/roles'
import nodemailer from 'nodemailer'

interface LegacyPerms { ads: boolean; sidekick: boolean; syncAds: boolean }

// email 邀請可指派的角色（Owner 只能由 OAuth 首連產生，不可被邀請）。
function resolveInviteRole(body: { role?: unknown; permissions?: LegacyPerms }): Role {
  if (isRole(body.role) && body.role !== 'owner') return body.role
  // 回溯相容：舊前端只送 permissions 時，映射成角色。
  return roleFromLegacyPerms(body.permissions)
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: '管理員', editor: '編輯者', viewer: '檢視者' }

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

  const body = await req.json()
  const { email, pageId } = body as { email?: string; pageId?: string }
  if (!email || !pageId) return NextResponse.json({ error: 'Missing email or pageId' }, { status: 400 })

  // 授權：呼叫者需對此頁有「管理成員」能力（owner/admin）。走集中授權層，
  // 不再只認 metaTokens，故受邀成 admin 的人也能再邀請他人。
  if (!(await can(uid, pageId, 'members.manage'))) {
    return NextResponse.json({ error: '你沒有管理此粉絲頁成員的權限' }, { status: 403 })
  }

  const role = resolveInviteRole(body)
  const permissions = legacyPermsForRole(role)

  // 頁名一律從「頁的 owner」解析，不靠呼叫者 metaTokens（受邀 admin 可能沒有 token）。
  let pageName = ''
  let igUserId: string | null = null
  const ownerUid = await resolvePageOwnerUid(pageId)
  if (ownerUid) {
    const ownerTok = await adminDb.collection('users').doc(ownerUid).collection('metaTokens').doc(pageId).get()
    pageName = ownerTok.data()?.pageName ?? ''
    igUserId = ownerTok.data()?.igUserId ?? null
  }

  const normalizedEmail = email.toLowerCase().trim()
  const inviteData = {
    role,
    permissions,
    invitedBy: uid,
    pageName,
    igUserId,
    createdAt: new Date(),
    status: 'pending',
  }

  const batch = adminDb.batch()
  batch.set(adminDb.collection('invites').doc(normalizedEmail).collection('pages').doc(pageId), inviteData)
  // Mirror in pages/{pageId}/pendingInvites for easy admin listing
  batch.set(adminDb.collection('pages').doc(pageId).collection('pendingInvites').doc(normalizedEmail), {
    email: normalizedEmail, role, permissions, invitedBy: uid, createdAt: new Date(),
  })
  await batch.commit()

  // Send invitation email
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://tm-contentloop.vercel.app'}/auth/login?invited=1`
  const roleText = `${ROLE_LABEL[role]}（${role === 'admin' ? '可管理與發布' : role === 'editor' ? '可建立草稿與同步' : '唯讀成效'}）`

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
              <p style="font-size:12px;color:#6B7280;margin:0 0 8px;font-weight:600">你的角色</p>
              <p style="font-size:14px;color:#374151;margin:0">${roleText}</p>
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
