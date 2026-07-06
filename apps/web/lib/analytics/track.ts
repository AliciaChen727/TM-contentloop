// Thin, safe wrapper around GA4's gtag for product-usage events.
// No-ops when GA isn't loaded (env var unset, SSR, ad-blocker) so callers never
// need to guard. NEVER pass PII (email, message content, tokens) — feature-usage
// signals only.

type GtagParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    gtag?: (command: string, ...args: unknown[]) => void
  }
}

export function trackEvent(name: string, params?: GtagParams): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  try {
    window.gtag('event', name, params ?? {})
  } catch { /* analytics must never break the app */ }
}
