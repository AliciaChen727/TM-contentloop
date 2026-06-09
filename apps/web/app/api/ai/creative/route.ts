export const dynamic = 'force-dynamic'
export const maxDuration = 120
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getUserApiKey } from '@/lib/userApiKeys'
import { resolvePageProfile } from '@/lib/page-profile'
import { checkImageQuota } from '@/lib/quota'
import { recordImageGeneration } from '@/lib/usage'
import { generateImage, type ImageEngine } from '@/lib/ai/generateImage'
import { maybeOverlayBrandAsset } from '@/lib/ai/overlayBrandAsset'

const VALID_ENGINES: ImageEngine[] = ['vertex-imagen', 'fal-recraft', 'fal-flux', 'fal-grok-image', 'fal-gpt-image-2']

interface CreativeBrief {
  imagePrompt: string
  headline: string
  subhead: string
  cta: string
  rationale: string
}

// Claude can wrap JSON in prose or code fences — extract the first {...} block.
function parseBrief(raw: string): CreativeBrief | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const o = JSON.parse(raw.slice(start, end + 1))
    if (!o.imagePrompt) return null
    return {
      imagePrompt: String(o.imagePrompt),
      headline: String(o.headline ?? ''),
      subhead: String(o.subhead ?? ''),
      cta: String(o.cta ?? ''),
      rationale: String(o.rationale ?? ''),
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let uid: string
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Language: prefer the UI language sent in the request, fall back to the stored
  // preference (English mode → English copy + baked-text image variant).
  const bodyForLang = await req.clone().json().catch(() => ({})) as { language?: string }
  const prefSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const en = bodyForLang.language === 'en' || (bodyForLang.language !== 'zh-TW' && prefSnap.data()?.language === 'en')

  const quota = await checkImageQuota(uid)
  if (!quota.ok) {
    return NextResponse.json(
      { error: en
          ? `Monthly image quota used up (${quota.used}/${quota.limit}). Upgrade to Pro for more.`
          : `本月圖片額度已用盡（${quota.used}/${quota.limit} 張）。升級 Pro 方案可獲得更多額度。` },
      { status: 429 },
    )
  }

  const { pageId, brief, engine } = await req.json() as {
    pageId?: string; brief?: string; engine?: ImageEngine
  }

  const anthropicKey = await getUserApiKey(uid, 'anthropic') ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) return NextResponse.json({ error: 'NO_API_KEY', type: 'anthropic' }, { status: 402 })
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  const profile = await resolvePageProfile(uid, pageId ?? null)
  const profileLines = [
    profile.brandName ? `品牌：${profile.brandName}` : '',
    profile.industry ? `產業：${profile.industry}${profile.industryOther ? `（${profile.industryOther}）` : ''}` : '',
    profile.optimizationGoal ? `廣告目標：${profile.optimizationGoal}` : '',
    profile.extraContext ? `補充背景：${profile.extraContext}` : '',
  ].filter(Boolean).join('\n')

  const system = en
    ? `You are a senior advertising creative director. Based on the brand info and the user's request, produce an "optimized ad creative brief".
Output STRICT JSON only (no markdown, no extra prose), with this structure:
{
  "imagePrompt": "English. Describe the ad visual base image: scene, subject, color, composition, photography/design style. Keep it clean (text will be added separately) — do NOT bake long copy into it here.",
  "headline": "English headline (the main reader-facing line)",
  "subhead": "English subhead",
  "cta": "English call-to-action (e.g. Sign up now, Learn more)",
  "rationale": "English, 2-3 sentences explaining why this visual direction and copy will improve ad performance."
}`
    : `你是資深廣告創意總監。根據品牌資料與使用者需求，產出一份「優化版廣告創意簡報」。
嚴格只輸出 JSON（不要 markdown、不要多餘文字），結構如下：
{
  "imagePrompt": "英文。描述要生成的廣告視覺底圖：場景、主體、配色、構圖、攝影/設計風格。可包含簡短的英文標語或品牌字，但【絕對不要】包含任何中文字（AI 圖片模型無法正確渲染中文，會變亂碼）。",
  "headline": "繁體中文主標題（給人閱讀，稍後會以可編輯文字疊在圖上）",
  "subhead": "繁體中文副標題",
  "cta": "繁體中文行動呼籲（例如：立即報名、了解更多）",
  "rationale": "繁體中文，2-3 句。說明這個視覺方向與文案為何能改善廣告成效。"
}`

  const userContent = en
    ? `${profileLines || '(no brand info)'}\n\nUser request: ${brief?.trim() || 'Produce an eye-catching social-ad visual and matching copy for this brand.'}`
    : `${profileLines || '（無品牌資料）'}\n\n使用者需求：${brief?.trim() || '請為此品牌產出一張吸睛、適合社群投放的廣告視覺與配套文案。'}`

  let parsed: CreativeBrief | null
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    parsed = parseBrief(raw)
  } catch {
    return NextResponse.json({ error: en ? 'AI creative generation failed, please retry' : 'AI 創意產生失敗，請再試一次' }, { status: 500 })
  }
  if (!parsed) return NextResponse.json({ error: en ? 'Unexpected AI response format, please retry' : 'AI 回應格式異常，請再試一次' }, { status: 500 })

  const chosenEngine: ImageEngine = engine && VALID_ENGINES.includes(engine) ? engine : 'fal-grok-image'

  // Clean base image (no baked copy) — for the "overlay editable text" approach.
  let img
  try {
    img = await generateImage(chosenEngine, parsed.imagePrompt)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : (en ? 'Image generation failed' : '圖片生成失敗') }, { status: 500 })
  }
  await recordImageGeneration(uid)
  const ov = await maybeOverlayBrandAsset(pageId, `${brief ?? ''}\n${parsed.imagePrompt}`, img.imageData)

  // English mode → also produce a "baked text" variant: render the English
  // headline/CTA directly into the image (gen models handle English type well).
  // The user picks between the two. (zh stays single clean base + overlay copy,
  // since AI image models can't render Chinese reliably.)
  let baked: { imageData: string; mimeType: string } | null = null
  if (en) {
    const ctaPart = parsed.cta ? ` and a call-to-action "${parsed.cta}"` : ''
    const bakedPrompt = `${parsed.imagePrompt} Integrate the headline text "${parsed.headline}"${ctaPart} into the design as clean, bold, correctly-spelled English typography that fits the layout.`
    try {
      const b = await generateImage(chosenEngine, bakedPrompt)
      await recordImageGeneration(uid)
      const bov = await maybeOverlayBrandAsset(pageId, `${brief ?? ''}\n${bakedPrompt}`, b.imageData)
      baked = { imageData: bov.overlaid ? bov.imageData : b.imageData, mimeType: bov.overlaid ? bov.mimeType : b.mimeType }
    } catch {
      baked = null // best-effort; clean base still returned
    }
  }

  return NextResponse.json({
    imageData: ov.overlaid ? ov.imageData : img.imageData,
    mimeType: ov.overlaid ? ov.mimeType : img.mimeType,
    brandOverlaid: ov.overlaid,
    brandAsset: ov.assetName ?? null,
    // English-only second variant with text baked into the image.
    imageDataBaked: baked?.imageData ?? null,
    bakedMimeType: baked?.mimeType ?? null,
    engine: chosenEngine,
    headline: parsed.headline,
    subhead: parsed.subhead,
    cta: parsed.cta,
    rationale: parsed.rationale,
    imagePrompt: parsed.imagePrompt,
  })
}
