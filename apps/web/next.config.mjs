/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@google/genai', 'ffmpeg-static'],
    // Vercel 的檔案追蹤只追 JS import，不會把 ffmpeg 的「二進位執行檔」帶進
    // lambda（workspaces 又把它裝在 repo 根目錄 node_modules）→ 正式環境
    // spawn .../ffmpeg-static/ffmpeg ENOENT。明確把二進位檔打包進每一條會
    // 跑 ffmpeg 的 route（音樂合成/封面截圖/發布/限動補發/排程 cron）。
    outputFileTracingIncludes: {
      '/api/content-drafts/media/compose': ['./node_modules/ffmpeg-static/**', '../../node_modules/ffmpeg-static/**'],
      '/api/content-drafts/media/frame': ['./node_modules/ffmpeg-static/**', '../../node_modules/ffmpeg-static/**'],
      '/api/content-drafts/[id]/publish': ['./node_modules/ffmpeg-static/**', '../../node_modules/ffmpeg-static/**'],
      '/api/content-drafts/[id]/fb-story': ['./node_modules/ffmpeg-static/**', '../../node_modules/ffmpeg-static/**'],
      '/api/cron/publish-scheduled': ['./node_modules/ffmpeg-static/**', '../../node_modules/ffmpeg-static/**'],
    },
  },
  // Firebase Auth same-origin fix: serve the auth handler from our own domain so
  // signInWithPopup no longer does a cross-domain (firebaseapp.com) handshake —
  // that handshake breaks under browsers' third-party-cookie blocking and caused
  // the occasional double sign-in (選帳號→又選帳號). Requires
  // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN set to this app's own domain
  // (e.g. tm-contentloop.vercel.app). Proxies the auth handler + init config to
  // the Firebase project's domain.
  async rewrites() {
    return [
      { source: '/__/auth/:path*', destination: 'https://contentloop-dev.firebaseapp.com/__/auth/:path*' },
      { source: '/__/firebase/:path*', destination: 'https://contentloop-dev.firebaseapp.com/__/firebase/:path*' },
    ]
  },
};

export default nextConfig;
