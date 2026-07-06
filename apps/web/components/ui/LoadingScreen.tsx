'use client'

import { useLang } from '@/lib/i18n/LanguageProvider'

// Friendly loading state: a cat gallops across a dashed line while the label
// stays clearly readable. Drop inside any centered container (or use fullscreen).
export function LoadingScreen({ label, fullscreen = false }: { label?: string; fullscreen?: boolean }) {
  const { L } = useLang()
  const body = (
    <div className="cl-loading">
      <div className="cl-loading-track" aria-hidden="true">
        <span className="cl-loading-dust">💨</span>
        <span className="cl-loading-cat" role="img" aria-label="cat">🐈</span>
      </div>
      <p className="cl-loading-text">{label ?? L('載入中', 'Loading')}</p>
    </div>
  )
  if (!fullscreen) return body
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">{body}</main>
  )
}
