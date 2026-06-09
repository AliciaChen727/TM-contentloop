'use client'

import { LanguageProvider } from '@/lib/i18n/LanguageProvider'

// Wraps every /dashboard/* page so any component can call useLang() to switch
// between 繁中 / English. Language preference is stored per-user in
// users/{uid}/settings/preferences.language and mirrored to localStorage for
// instant, flicker-free switching.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>
}
