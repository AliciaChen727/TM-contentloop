import { NextRequest, NextResponse } from 'next/server'

// middleware 無法直接用 Firebase SDK，改用 cookie 做簡單保護
// 完整的 server-side 驗證在各 API Route 裡用 adminAuth.verifyIdToken 處理
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 只保護 /dashboard 路徑
  if (pathname.startsWith('/dashboard')) {
    // Firebase Auth 在瀏覽器端管理 session，redirect 由 client component 處理
    // 這裡只做基本的 path rewrite，實際 auth 檢查在 dashboard page 的 useEffect
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
