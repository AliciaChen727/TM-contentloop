import { Resend } from 'resend'
import type { AdAlert } from './detector'

const FROM = process.env.ALERT_EMAIL_FROM ?? 'ContentLoop <onboarding@resend.dev>'
const DASHBOARD_URL = 'https://tm-contentloop.vercel.app/dashboard/ads'

const TYPE_EMOJI: Record<AdAlert['type'], string> = {
  ctr_drop: '📉', frequency_high: '⚠️', cpc_spike: '💸',
}

// Send one digest email listing all current ad alerts for a page.
export async function sendAlertEmail(
  to: string, pageName: string, alerts: AdAlert[],
): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' }
  if (!to || alerts.length === 0) return { ok: false, error: 'no recipient or no alerts' }

  const resend = new Resend(key)

  const rows = alerts.map(a => `
    <tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;line-height:1.5;color:#1f2937">
      <span style="font-size:16px">${TYPE_EMOJI[a.type]}</span>&nbsp; ${a.message}
    </td></tr>`).join('')

  const html = `
  <div style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px;color:#111827;margin-bottom:4px">📊 廣告成效警示 — ${pageName}</h2>
    <p style="font-size:13px;color:#6b7280;margin-top:0">偵測到 ${alerts.length} 項需要注意的廣告異常：</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">${rows}</table>
    <p style="margin-top:20px">
      <a href="${DASHBOARD_URL}" style="display:inline-block;background:#3b6fd4;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">查看 AI 診斷 →</a>
    </p>
    <p style="font-size:11px;color:#9ca3af;margin-top:24px">ContentLoop · 你可在設定頁調整通知頻率或關閉警示</p>
  </div>`

  const subject = alerts.length === 1
    ? `[ContentLoop] ${pageName} 廣告警示：${alerts[0].message.slice(0, 30)}`
    : `[ContentLoop] ${pageName} 有 ${alerts.length} 項廣告警示`

  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html })
    if (error) return { ok: false, error: String(error) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
