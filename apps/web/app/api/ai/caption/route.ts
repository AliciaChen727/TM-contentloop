/**
 * AI caption generation for content drafts (Agent 自動發布 S2+). Copy-only —
 * does NOT generate images (no image quota). Uses Haiku + the page's profile
 * for on-brand Toastmasters voice. BFF: Bearer + page access. Returns { caption }.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { resolvePageProfile } from '@/lib/page-profile'
import { fetchTopPostExamples } from '@/lib/content/historyExamples'

async function canManage(uid: string, pageId: string): Promise<boolean> {
  if (isSuperAdmin(uid)) return true
  const own = await adminDb.collection('users').doc(uid).collection('metaTokens').doc(pageId).get()
  if (own.exists) return true
  const admin = await adminDb.collection('pages').doc(pageId).collection('admins').doc(uid).get()
  return admin.exists
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try { uid = (await adminAuth.verifyIdToken(idToken)).uid }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }

  const { pageId, targets, mediaType, seed, lang, settings, useHistory } = (await req.json().catch(() => ({}))) as {
    pageId?: string; targets?: string[]; mediaType?: string; seed?: string; lang?: string; useHistory?: boolean
    settings?: { tone?: string; goal?: string; cta?: string; language?: string; info?: Record<string, string> }
  }
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  if (!(await canManage(uid, pageId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const anthropicKey = await getUserApiKey(uid, 'anthropic') ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })

  const profile = await resolvePageProfile(uid, pageId)
  // Output language: explicit settings.language wins, else UI lang.
  const en = (settings?.language ?? lang) === 'en'
  const wantsThreads = Array.isArray(targets) && targets.includes('th')

  // Required facts the AI must weave in (never invent) — only non-empty ones.
  const infoLines = Object.entries(settings?.info ?? {})
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `  · ${k}：${String(v).trim()}`)

  const ctx = [
    profile.brandName ? `品牌：${profile.brandName}` : '',
    profile.industry ? `產業：${profile.industry}${profile.industryOther ? `（${profile.industryOther}）` : ''}` : '',
    profile.extraContext ? `補充背景：${profile.extraContext}` : '',
    mediaType ? `媒體型態：${mediaType}` : '',
    settings?.goal ? `文案目標：${settings.goal}` : '',
    settings?.tone ? `語氣風格：${settings.tone}` : '',
    settings?.cta ? `指定 CTA（結尾行動呼籲）：${settings.cta}` : '',
    infoLines.length ? `必要資訊（務必自然融入，不可捏造未提供的內容）：\n${infoLines.join('\n')}` : '',
  ].filter(Boolean).join('\n')

  const rules = [
    en ? 'Write in natural English.' : '用自然、口語的繁體中文書寫。',
    wantsThreads ? (en ? 'Keep it tight; if it must run long it will be split into a Threads reply chain.' : '盡量精簡；若必要可較長（Threads 會自動切成回覆串）。') : '',
    settings?.tone ? (en ? `Match this tone: ${settings.tone}.` : `語氣須符合：${settings.tone}。`) : (en ? 'Warm, encouraging voice.' : '語氣溫暖鼓勵。'),
    settings?.goal ? (en ? `Optimize the copy for this goal: ${settings.goal}.` : `文案要服務這個目標：${settings.goal}。`) : '',
    settings?.cta ? (en ? `End with a CTA consistent with the goal: "${settings.cta}".` : `結尾用與目標一致的 CTA：「${settings.cta}」。`) : (en ? 'End with a light CTA.' : '結尾給輕量行動呼籲。'),
    infoLines.length ? (en ? 'Weave in every provided fact accurately; do NOT invent unstated details.' : '準確帶入每一項必要資訊；未提供的細節絕不捏造。') : '',
    en ? 'Concrete, not salesy. Inviting hook first.' : '具體不推銷，開頭吸睛。',
    en ? 'Output ONLY the caption text — no quotes, no explanations, no markdown.' : '只輸出貼文文案本身——不要引號、不要說明、不要 markdown。',
  ].filter(Boolean).map(s => `- ${s}`).join('\n')

  const seedLine = seed?.trim() ? `\n\n使用者給的主題/現有草稿（請據此改寫或延伸）：\n${seed.trim()}` : ''

  // Optionally ground in the page's own best-performing past posts (page-scoped,
  // isolated) so the voice matches what resonated with THIS audience — not copied.
  let historyBlock = ''
  if (useHistory !== false) {
    const examples = await fetchTopPostExamples(pageId, 4).catch(() => [])
    if (examples.length) {
      const list = examples.map((e, i) => `【範例 ${i + 1}】\n${e}`).join('\n\n')
      historyBlock = `\n\n以下是這個粉專「成效最好的歷史貼文」——請學習它們的口吻、句型節奏與長度，寫出全新內容，${en ? 'do NOT copy them.' : '但絕不可照抄或改寫這些既有貼文：'}\n\n${list}`
    }
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `為以下粉專生成一則社群貼文文案。\n\n${ctx}\n\n規則：\n${rules}${seedLine}${historyBlock}`,
      }],
    })
    const caption = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    if (!caption) return NextResponse.json({ error: en ? 'Generation failed, please retry' : '生成失敗，請再試一次' }, { status: 500 })
    return NextResponse.json({ caption })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'caption generation failed' }, { status: 500 })
  }
}
