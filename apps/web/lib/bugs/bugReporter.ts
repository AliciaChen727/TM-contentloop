// Phase 3B Slice 18 (+ Phase 3C Telegram) — bug 回報 pipeline core.
// Agents/crons call reportBug() when they detect something broken (tool
// execution error, data inconsistency, publish anomaly). Flow:
//   bugReports/{id} (per-day idempotent) → bell notification to super-admins
//   → GitHub Issue (for the Slice 19 fix agent; needs GITHUB_BUG_TOKEN)
//   → Telegram push (needs TELEGRAM_BOT_TOKEN + BUG_ALERT_TELEGRAM_CHAT_ID).
// REPORT ONLY — nothing here ever attempts a fix (human gate first, per plan).

import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeInAppNotification } from '@/lib/notifications/store'

export type BugSeverity = 'critical' | 'warning' | 'info'

export interface BugReportInput {
  source: string                          // e.g. 'cron_sync' | 'sidekick_tool' | 'publish'
  title: string                           // short, stable (used in dedupe fingerprint)
  detail: string                          // what happened / raw error
  context?: Record<string, unknown>       // pageId, ids, numbers — JSON-serializable
  severity?: BugSeverity                  // omit → haiku classifies (fallback 'warning')
}

const REPO = process.env.GITHUB_BUG_REPO ?? 'AliciaChen727/TM-contentloop'

// One cheap haiku call: severity + one-line zh summary. Best-effort — any
// failure falls back to heuristics so reporting never blocks the caller.
async function classify(input: BugReportInput): Promise<{ severity: BugSeverity; summary: string }> {
  const fallback = { severity: 'warning' as BugSeverity, summary: input.title }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return fallback
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: '你是工程告警分類器。依據 bug 描述回傳嚴格 JSON：{"severity":"critical|warning|info","summary":"一句繁中摘要（<40字，寫給非工程師的產品負責人看）"}。critical=資料錯誤/洩漏/發布失敗；warning=功能退化但有 fallback；info=可觀察即可。只輸出 JSON。',
      messages: [{ role: 'user', content: `來源：${input.source}\n標題：${input.title}\n細節：${input.detail.slice(0, 800)}\ncontext：${JSON.stringify(input.context ?? {}).slice(0, 500)}` }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return fallback
    const parsed = JSON.parse(m[0]) as { severity?: string; summary?: string }
    const severity: BugSeverity = parsed.severity === 'critical' || parsed.severity === 'info' ? parsed.severity : 'warning'
    return { severity, summary: parsed.summary?.slice(0, 120) || input.title }
  } catch (e) {
    console.warn('[reportBug] classify failed, using heuristic severity:', e instanceof Error ? e.message : e)
    return fallback
  }
}

async function createGithubIssue(input: BugReportInput, severity: BugSeverity, summary: string): Promise<string | null> {
  const token = process.env.GITHUB_BUG_TOKEN
  if (!token) return null
  try {
    const body = [
      `> 🤖 由 ContentLoop bug 回報 pipeline 自動建立（Slice 18）。`,
      `> **修復需經人工核准**：確認要修的話，到 [Actions → AI Bug Fix Agent](https://github.com/${REPO}/actions/workflows/bug-fix-agent.yml) 按 Run workflow、輸入本 Issue 編號 — agent 只會開 PR（無 merge 權限），review 後才 merge。`,
      '',
      `**嚴重度**：${severity}`,
      `**來源**：\`${input.source}\``,
      `**摘要**：${summary}`,
      '',
      '## 細節',
      '```',
      input.detail.slice(0, 3000),
      '```',
      '',
      '## Context',
      '```json',
      JSON.stringify(input.context ?? {}, null, 2).slice(0, 2000),
      '```',
    ].join('\n')
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: `[AI] ${input.title}`, body, labels: ['bug', 'ai-reported'] }),
    })
    if (!res.ok) return null
    const j = await res.json()
    return typeof j.html_url === 'string' ? j.html_url : null
  } catch (e) {
    // Invisible before → if Issue creation breaks, the whole fix pipeline stalls
    // silently (bell still fires, but there's no Issue to dispatch the fix agent on).
    console.error('[reportBug] createGithubIssue failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// Push straight to the owner's phone via the same bot used by the ops-bot
// (Phase 3C). Best-effort — never throws, silently no-ops if unconfigured.
async function notifyTelegram(severity: BugSeverity, summary: string, input: BugReportInput, issueUrl: string | null): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.BUG_ALERT_TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    const sevEmoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'
    const lines = [
      `${sevEmoji} <b>${summary}</b>`,
      `來源：${input.source}`,
      issueUrl ? `Issue：${issueUrl}` : '（未開 GitHub Issue）',
    ]
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }),
    })
  } catch (e) {
    // best-effort — bell + GitHub Issue already carry the report, but log so a
    // broken Telegram push isn't completely invisible.
    console.warn('[reportBug] notifyTelegram failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Report a bug. Per-day idempotent on (source + title): repeats the same day
 * just bump `count` — no duplicate notifications / issues. Never throws.
 */
export async function reportBug(input: BugReportInput): Promise<{ id: string; deduped: boolean }> {
  const dateStr = new Date().toISOString().slice(0, 10)
  const fp = createHash('sha1').update(`${input.source}|${input.title}`).digest('hex').slice(0, 12)
  const id = `bug__${fp}__${dateStr}`
  try {
    const ref = adminDb.collection('bugReports').doc(id)
    const existing = await ref.get()
    if (existing.exists) {
      await ref.set({ count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(), lastDetail: input.detail.slice(0, 2000) }, { merge: true })
      return { id, deduped: true }
    }

    const { severity, summary } = input.severity
      ? { severity: input.severity, summary: input.title }
      : await classify(input)
    const issueUrl = await createGithubIssue(input, severity, summary)

    await ref.set({
      source: input.source,
      title: input.title,
      summary,
      detail: input.detail.slice(0, 4000),
      context: JSON.parse(JSON.stringify(input.context ?? {})),
      severity,
      status: 'open',                    // open → acknowledged → fixing → closed
      githubIssueUrl: issueUrl,
      count: 1,
      dateStr,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Bell notification to super-admins (product owner). Reuses the Phase 2
    // notification center; per-day idempotent via the same doc-id scheme.
    const superAdmins = (process.env.SUPER_ADMIN_UIDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const sevEmoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'
    await writeInAppNotification(superAdmins, {
      type: 'system',
      pageId: `bug-${fp}`,
      pageName: 'AI Bug 回報',
      title: `${sevEmoji} ${summary}`,
      body: `${input.source}：${input.detail.slice(0, 300)}`,
      advice: issueUrl
        ? 'GitHub Issue 已建立。要修的話：GitHub → Actions → AI Bug Fix Agent → Run workflow（輸入 Issue 編號）→ agent 開 PR → 你 review 後 merge。'
        : '（未設定 GITHUB_BUG_TOKEN，未開 Issue）',
      alertKeys: [id],
      deepLink: issueUrl ?? '/dashboard',
      dateStr,
    }).catch(() => {})

    await notifyTelegram(severity, summary, input, issueUrl)

    return { id, deduped: false }
  } catch (e) {
    // The whole report failing (e.g. Firestore write) was silent → you'd never
    // know bugs stopped being recorded. Log, but still never throw on the caller.
    console.error('[reportBug] failed to record bug', id, '-', e instanceof Error ? e.message : e)
    return { id, deduped: false }
  }
}
