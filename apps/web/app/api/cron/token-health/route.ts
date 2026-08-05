export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import nodemailer from 'nodemailer'
import { isReauthRequired, markTokenStatus } from '@/lib/meta/tokenError'
import { writeInAppNotification } from '@/lib/notifications/store'
import { reportBug } from '@/lib/bugs/bugReporter'
import { superAdminUids } from '@/lib/auth/superadmin'

// Daily Meta-token health check (triggered by GitHub Actions cron).
// Silent token expiry was invisible before: a page's stored Page access token
// could go invalid and every sync would fail quietly while the dashboard served
// stale data (see memory project_token_invalid_silent_sync / Chill Hi High 2026-07).
// This cron lightly probes EVERY stored token, flags dead ones (so the dashboard
// shows the reconnect banner), and fans the problem out to the 紅點 / email /
// bug pipeline so it surfaces on its own. Healthy tokens self-heal the flag.

const BASE = 'https://graph.facebook.com/v19.0'
const PROBE_CONCURRENCY = 20
// Many pages failing at once points at an App-level cause (App Review status, app
// mode, shared secret) rather than one user's lapsed grant → escalate to critical.
const APP_LEVEL_THRESHOLD = 3

interface TokenDoc { ownerUid: string; pageId: string; pageName: string; accessToken: string; prevValid: boolean }
type ProbeStatus = 'valid' | 'invalid' | 'skip'
interface ProbeResult { t: TokenDoc; status: ProbeStatus; message?: string }

// Enumerate every stored page token across all users (collectionGroup covers the
// per-user metaTokens subcollections). The same page held by two admins is probed
// independently — each is a distinct token.
async function listAllTokens(): Promise<TokenDoc[]> {
  const snap = await adminDb.collectionGroup('metaTokens').get()
  const out: TokenDoc[] = []
  for (const d of snap.docs) {
    if (d.id === 'userToken' || d.id === 'page') continue // skip legacy/user-token docs
    const data = d.data() as { accessToken?: string; pageName?: string; tokenValid?: boolean }
    const ownerUid = d.ref.parent.parent?.id
    if (!ownerUid || !data.accessToken) continue
    out.push({ ownerUid, pageId: d.id, pageName: data.pageName ?? d.id, accessToken: data.accessToken, prevValid: data.tokenValid !== false })
  }
  return out
}

// A definitive OAuthException → invalid. Any other error (network / transient /
// rate limit) → skip: never flip a token to invalid on a flaky call.
async function probe(t: TokenDoc): Promise<ProbeResult> {
  try {
    const r = await fetch(`${BASE}/${t.pageId}?fields=name&access_token=${encodeURIComponent(t.accessToken)}`)
    const d = await r.json()
    if (d.error) {
      return isReauthRequired(d.error)
        ? { t, status: 'invalid', message: String(d.error.message ?? 'OAuthException') }
        : { t, status: 'skip', message: String(d.error.message ?? 'non-auth error') }
    }
    return { t, status: 'valid' }
  } catch (e) {
    return { t, status: 'skip', message: e instanceof Error ? e.message : 'probe failed' }
  }
}

async function probeAll(tokens: TokenDoc[]): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  for (let i = 0; i < tokens.length; i += PROBE_CONCURRENCY) {
    out.push(...(await Promise.all(tokens.slice(i, i + PROBE_CONCURRENCY).map(probe))))
  }
  return out
}

async function sendDigestEmail(invalid: ProbeResult[], appLevel: boolean): Promise<boolean> {
  const GMAIL_USER = process.env.GMAIL_USER
  const to = process.env.HEALTH_ALERT_EMAIL ?? GMAIL_USER
  if (!GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !to) return false
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
  const rows = invalid.map(r => `<li style="margin-bottom:8px;line-height:1.6"><strong>${r.t.pageName}</strong>（pageId ${r.t.pageId}）：${r.message ?? '授權失效'}</li>`).join('')
  const banner = appLevel
    ? `<p style="font-size:13px;color:#b91c1c;font-weight:700">⚠️ 有 ${invalid.length} 個粉專同時失效 —— 疑似 App 層級問題（App Review 狀態 / App mode / 共用 secret），請優先檢查。</p>`
    : ''
  const html = `
  <div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px;color:#111827">🔑 ContentLoop Meta 授權健康檢查</h2>
    ${banner}
    <p style="font-size:13px;color:#6b7280">以下粉專的 Facebook 授權已失效，最新資料無法同步，需該粉專的 FB 管理員重新授權：</p>
    <ul style="font-size:14px;color:#1f2937;padding-left:20px">${rows}</ul>
    <p style="font-size:11px;color:#9ca3af;margin-top:24px">ContentLoop · 每日自動授權健康檢查（全部正常時不寄信）</p>
  </div>`
  try {
    await transporter.sendMail({ from: `ContentLoop <${GMAIL_USER}>`, to, subject: `[ContentLoop] Meta 授權失效：${invalid.length} 個粉專`, html })
    return true
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokens = await listAllTokens()
  const results = await probeAll(tokens)
  const invalid = results.filter(r => r.status === 'invalid')
  const recovered = results.filter(r => r.status === 'valid' && !r.t.prevValid)

  // Persist only real transitions (idempotent, but avoids needless daily writes):
  // newly-dead tokens → flag false; recovered tokens → clear the flag (self-heal).
  // This stays PER-TOKEN so each user's own reconnect banner (/api/pages reads
  // their own metaTokens.tokenValid) is accurate.
  await Promise.all([
    ...invalid.filter(r => r.t.prevValid).map(r => markTokenStatus(r.t.ownerUid, r.t.pageId, false, r.message)),
    ...recovered.map(r => markTokenStatus(r.t.ownerUid, r.t.pageId, true)),
  ])

  // A page is genuinely down only when NONE of its stored tokens work. The same
  // page is often held by two admins (e.g. Legacy 235543696463178: one live owner
  // token + one stale duplicate). Daily sync (api/cron/sync) iterates ALL tokens
  // via collectionGroup and writes page-scoped data, so ANY valid token keeps the
  // page fresh. Alerting per-token spammed a daily GitHub issue + Telegram + email
  // for pages that were never actually broken (2026-08). So fan out page-level
  // alerts ONLY for pages with zero working tokens — one alert per dead page.
  const healthyPageIds = new Set(results.filter(r => r.status === 'valid').map(r => r.t.pageId))
  const seenDeadPages = new Set<string>()
  const pageInvalid = invalid.filter(r => {
    if (healthyPageIds.has(r.t.pageId)) return false // another admin's token still works → page is fine
    if (seenDeadPages.has(r.t.pageId)) return false  // dedupe: one alert per dead page, not per token
    seenDeadPages.add(r.t.pageId)
    return true
  })

  // 紅點: fan out to the token owner (who can fix it) + super-admins. Per-day
  // deterministic id (system__{pageId}__{date}) → one bell/day, updated in place.
  const supers = superAdminUids()
  const dateStr = new Date().toISOString().slice(0, 10)
  for (const r of pageInvalid) {
    await writeInAppNotification(Array.from(new Set([r.t.ownerUid, ...supers])), {
      type: 'system',
      pageId: r.t.pageId,
      pageName: r.t.pageName,
      title: `${r.t.pageName}：Facebook 授權已失效`,
      body: '此粉專的 Meta 存取權杖已失效，最新貼文／廣告成效無法同步。',
      advice: '請該粉專的 Facebook 管理員到 ContentLoop 重新授權，即可恢復更新。',
      actionPrompt: null,
      alertKeys: [`token_invalid__${r.t.pageId}`],
      deepLink: `/dashboard?pageId=${r.t.pageId}`,
      dateStr,
    }).catch(() => null)
  }

  // Bug/alert pipeline. Many at once → one critical App-level report; otherwise a
  // per-page warning. reportBug is per-day idempotent, so no spam.
  const appLevel = pageInvalid.length >= APP_LEVEL_THRESHOLD
  if (appLevel) {
    await reportBug({
      source: 'cron_token_health',
      title: `多個粉專 Meta token 同時失效（${pageInvalid.length}）`,
      detail: `疑似 App 層級問題。失效粉專：\n${pageInvalid.map(r => `- ${r.t.pageName} (${r.t.pageId}): ${r.message ?? ''}`).join('\n')}`,
      context: { count: pageInvalid.length, pageIds: pageInvalid.map(r => r.t.pageId) },
      severity: 'critical',
    }).catch(() => null)
  } else {
    for (const r of pageInvalid) {
      await reportBug({
        source: 'cron_token_health',
        title: `粉專 Meta token 失效：${r.t.pageName}`,
        detail: r.message ?? 'OAuthException — token 需重新授權',
        context: { pageId: r.t.pageId, ownerUid: r.t.ownerUid },
        severity: 'warning',
      }).catch(() => null)
    }
  }

  const emailed = pageInvalid.length > 0 ? await sendDigestEmail(pageInvalid, appLevel) : false

  const summary = {
    probed: tokens.length,
    invalidTokens: invalid.length,       // dead individual tokens (incl. stale duplicates of healthy pages)
    invalidPages: pageInvalid.length,    // pages with ZERO working tokens → the ones we actually alert on
    recovered: recovered.length,
    skipped: results.filter(r => r.status === 'skip').length,
    appLevel,
    emailed,
    deadPages: pageInvalid.map(r => ({ pageId: r.t.pageId, pageName: r.t.pageName })),
  }
  console.log('[cron/token-health]', JSON.stringify(summary))
  return NextResponse.json({ ok: true, ...summary })
}
