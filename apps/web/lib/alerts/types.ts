// Unified alert representation shared by the email + in-app notification sinks.
// Derived from the diagnosis engine (lib/ads/diagnosis.ts) so the 紅點 / email /
// 診斷建議 page all speak the same language. See docs/phase-2-notification-center.md.

export interface AlertItem {
  severity: 'critical' | 'warning'
  emoji: string
  title: string
  message: string   // one-line description (DiagItem.desc)
  advice: string    // recommended action (DiagItem.action)
  key: string       // stable id for dedup
}
