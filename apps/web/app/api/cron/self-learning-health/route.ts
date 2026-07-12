export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import nodemailer from 'nodemailer'

// Monthly self-learning health monitor (triggered by GitHub Actions cron). Emails
// the operator ONLY when something needs attention:
//   1. The Gemini judge / embedding model is no longer available (→ switch model).
//   2. A page's sidekickFeedback has grown past the in-memory-retrieval threshold
//      (→ consider a real vector DB). See project_gemini_text_models memory.

const REQUIRED_MODELS = ['models/gemini-2.5-flash', 'models/gemini-embedding-001']
const FEEDBACK_THRESHOLD = 2000

async function checkModels(): Promise<string[]> {
  const issues: string[] = []
  const key = process.env.GEMINI_API_KEY
  if (!key) return ['GEMINI_API_KEY 未設定，無法檢查模型可用性。']
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`)
    const d = await r.json()
    if (!r.ok || d.error) return [`查詢 Gemini 模型清單失敗：${d?.error?.message ?? r.status}`]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names: string[] = (d.models ?? []).map((m: any) => m.name)
    for (const m of REQUIRED_MODELS) {
      if (!names.includes(m)) issues.push(`模型「${m}」已不在可用清單 → 需更換（評審/檢索受影響）。`)
    }
  } catch (e) {
    issues.push(`查詢 Gemini 模型清單例外：${e instanceof Error ? e.message : e}`)
  }
  return issues
}

async function checkFeedbackVolume(): Promise<string[]> {
  const issues: string[] = []
  const pages = await adminDb.collection('pages').listDocuments()
  await Promise.all(pages.map(async (p) => {
    try {
      const agg = await p.collection('sidekickFeedback').count().get()
      const n = agg.data().count
      if (n > FEEDBACK_THRESHOLD) {
        issues.push(`粉專 ${p.id} 的 feedback 記錄已達 ${n} 筆（> ${FEEDBACK_THRESHOLD}）→ 考慮改用正式向量資料庫（目前只撈最近 100 筆，recall 會下降）。`)
      }
    } catch { /* skip page on error */ }
  }))
  return issues
}

// Judge validity (2026-07-12): does the LLM evaluator's score actually predict
// human adoption? Compares mean evalScore of adopted/edited vs rejected docs
// across all pages. If the gap is missing or inverted (with enough samples),
// the rubric — the foundation of the whole self-learning loop — needs review.
async function checkJudgeValidity(): Promise<{ issues: string[]; stats: Record<string, unknown> }> {
  const norm10 = (v: unknown) => (typeof v === 'number' ? (v <= 5 ? v * 2 : v) : null)
  let adoptedSum = 0, adoptedN = 0, rejectedSum = 0, rejectedN = 0
  try {
    const pages = await adminDb.collection('pages').listDocuments()
    for (const p of pages) {
      const snap = await p.collection('sidekickFeedback').orderBy('createdAt', 'desc').limit(300).get().catch(() => null)
      for (const doc of snap?.docs ?? []) {
        const d = doc.data()
        const score = norm10(d.evalScore)
        if (score === null) continue
        if (d.humanAction === 'adopted' || d.humanAction === 'edited') { adoptedSum += score; adoptedN++ }
        else if (d.humanAction === 'rejected') { rejectedSum += score; rejectedN++ }
      }
    }
  } catch { /* best-effort */ }
  const avgAdopted = adoptedN ? adoptedSum / adoptedN : null
  const avgRejected = rejectedN ? rejectedSum / rejectedN : null
  const gap = avgAdopted !== null && avgRejected !== null ? avgAdopted - avgRejected : null
  const stats = {
    adoptedN, rejectedN,
    avgScoreAdopted: avgAdopted !== null ? Number(avgAdopted.toFixed(2)) : null,
    avgScoreRejected: avgRejected !== null ? Number(avgRejected.toFixed(2)) : null,
    gap: gap !== null ? Number(gap.toFixed(2)) : null,
  }
  const issues: string[] = []
  // Only alert with a meaningful sample — tiny data would just be noise.
  if (adoptedN >= 10 && rejectedN >= 5 && gap !== null && gap < 0.5) {
    issues.push(`評審效度警告：被採納建議的平均評分（${stats.avgScoreAdopted}）沒有明顯高於被拒絕的（${stats.avgScoreRejected}，差距 ${stats.gap} < 0.5）→ LLM 評審分數與人類採納脫鉤，建議檢視 evaluator rubric（樣本：採納 ${adoptedN}、拒絕 ${rejectedN}）。`)
  }
  return { issues, stats }
}

async function sendHealthEmail(issues: string[]): Promise<boolean> {
  const GMAIL_USER = process.env.GMAIL_USER
  const to = process.env.HEALTH_ALERT_EMAIL ?? GMAIL_USER
  if (!GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !to) return false
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
  const rows = issues.map(i => `<li style="margin-bottom:8px;line-height:1.6">${i}</li>`).join('')
  const html = `
  <div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px;color:#111827">🔧 ContentLoop 自我學習系統健康檢查</h2>
    <p style="font-size:13px;color:#6b7280">本月偵測到 ${issues.length} 項需要注意：</p>
    <ul style="font-size:14px;color:#1f2937;padding-left:20px">${rows}</ul>
    <p style="font-size:11px;color:#9ca3af;margin-top:24px">ContentLoop · 每月自動健康檢查（無問題時不寄信）</p>
  </div>`
  try {
    await transporter.sendMail({ from: `ContentLoop <${GMAIL_USER}>`, to, subject: `[ContentLoop] 自我學習系統健康檢查：${issues.length} 項提醒`, html })
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

  const [modelIssues, volumeIssues, judge] = await Promise.all([checkModels(), checkFeedbackVolume(), checkJudgeValidity()])
  const issues = [...modelIssues, ...volumeIssues, ...judge.issues]
  const emailed = issues.length > 0 ? await sendHealthEmail(issues) : false

  console.log('[cron/self-learning-health]', JSON.stringify({ issues, emailed, judgeStats: judge.stats }))
  return NextResponse.json({ ok: true, issueCount: issues.length, issues, emailed, judgeStats: judge.stats })
}
