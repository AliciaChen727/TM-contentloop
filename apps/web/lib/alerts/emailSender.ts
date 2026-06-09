import nodemailer from 'nodemailer'
import type { AlertItem } from './types'
import type { AiDiagCard } from '@/components/ads/types'

const GMAIL_USER = process.env.GMAIL_USER ?? ''
const FROM = `ContentLoop <${GMAIL_USER}>`
const DASHBOARD_BASE = 'https://tm-contentloop.vercel.app/dashboard/ads'

// Send one digest email of the current 成效診斷優化建議 for a page (廣告 + 貼文).
// When Agent cards are available the email uses the Madgicx-style copy
// (title / why / impact / benchmark); otherwise it falls back to the rule alerts.
// pageId is appended to the dashboard link so the CTA opens the correct page.
export async function sendAlertEmail(
  to: string, pageName: string, alerts: AlertItem[], pageId?: string, cards?: AiDiagCard[] | null, en = false,
): Promise<{ ok: boolean; error?: string }> {
  if (!GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return { ok: false, error: 'GMAIL_USER / GMAIL_APP_PASSWORD not configured' }
  if (!to || alerts.length === 0) return { ok: false, error: 'no recipient or no alerts' }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  const dashboardUrl = pageId
    ? `${DASHBOARD_BASE}?pageId=${encodeURIComponent(pageId)}&section=diagnosis`
    : `${DASHBOARD_BASE}?section=diagnosis`

  const useCards = !!(cards && cards.length > 0)
  const count = useCards ? cards!.length : alerts.length

  const rows = useCards
    ? cards!.map(c => `
      <tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;line-height:1.5;color:#1f2937">
        <span style="font-size:16px">${c.emoji}</span>&nbsp; <strong>${c.title}</strong><br/>
        <span style="color:#374151">${c.why.join(' ')}</span>
        ${c.impact ? `<br/><span style="font-size:13px;color:#b45309;font-weight:600">${c.impact}</span>` : ''}
        ${c.benchmark ? `<br/><span style="font-size:12px;color:#6b7280">📊 ${c.benchmark}</span>` : ''}
        <br/><span style="font-size:12px;color:#6b7280">${en ? 'Suggestion' : '建議'}：${c.cta.label}</span>
      </td></tr>`).join('')
    : alerts.map(a => `
      <tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;line-height:1.5;color:#1f2937">
        <span style="font-size:16px">${a.emoji}</span>&nbsp; <strong>${a.title}</strong>${en ? ': ' : '：'}${a.message}<br/>
        <span style="font-size:12px;color:#6b7280">${en ? 'Suggestion' : '建議'}：${a.advice}</span>
      </td></tr>`).join('')

  const heading = en ? 'Performance Optimization Tips' : '成效診斷優化建議'
  const html = `
  <div style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px;color:#111827;margin-bottom:4px">📊 ${heading} — ${pageName}</h2>
    <p style="font-size:13px;color:#6b7280;margin-top:0">${en ? `We've gathered ${count} ad & content optimization tips for you:` : `為你整理了 ${count} 項廣告與內容的優化建議：`}</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">${rows}</table>
    <p style="margin-top:20px">
      <a href="${dashboardUrl}" style="display:inline-block;background:#3b6fd4;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">${en ? 'View AI Diagnosis →' : '查看 AI 診斷 →'}</a>
    </p>
    <p style="font-size:11px;color:#9ca3af;margin-top:24px">${en ? 'ContentLoop · Adjust notification frequency or turn it off in Settings' : 'ContentLoop · 你可在設定頁調整通知頻率或關閉'}</p>
  </div>`

  const firstTitle = useCards ? cards![0].title : alerts[0].title
  const subject = count === 1
    ? `[ContentLoop] ${pageName} ${en ? 'optimization tip' : '成效診斷優化建議'}：${firstTitle.slice(0, 30)}`
    : `[ContentLoop] ${pageName} ${en ? `optimization tips (${count})` : `成效診斷優化建議（${count} 項）`}`

  try {
    await transporter.sendMail({ from: FROM, to, subject, html })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
