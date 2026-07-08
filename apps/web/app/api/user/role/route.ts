export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserPageAccess } from '@/lib/auth/access'
import { capabilitiesForRole } from '@/lib/auth/roles'

export async function GET(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  if (isSuperAdmin(uid)) {
    return NextResponse.json({
      role: 'owner',
      capabilities: capabilitiesForRole('owner'),
      isOwner: true,
      isAdmin: true,
    })
  }

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ role: null, capabilities: [], isOwner: false, isAdmin: false })

  const access = await getUserPageAccess(uid, pageId)
  if (!access) return NextResponse.json({ role: null, capabilities: [], isOwner: false, isAdmin: false })

  const isAdmin = access.role === 'owner' || access.role === 'admin'
  // 回溯相容：現行 UI 讀 isOwner/isAdmin。舊版 /api/user/role 對「在 admins 子集合的人」
  // 一律回 isOwner=isAdmin（見 git 歷史註解），這裡維持同樣行為，避免 Phase A 改到既有 UI。
  // Phase B（members 模型成為權威、UI 驗證後）再收緊 isOwner = (role === 'owner')。
  const isOwner = isAdmin

  return NextResponse.json({
    role: access.role,
    capabilities: access.capabilities,
    isOwner,
    isAdmin,
  })
}
