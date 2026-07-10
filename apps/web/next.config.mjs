/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@google/genai', 'ffmpeg-static'],
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
