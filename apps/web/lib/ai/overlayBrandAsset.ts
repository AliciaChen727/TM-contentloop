import { adminDb } from '@/lib/firebase/admin'
import sharp from 'sharp'

// If the prompt mentions a brand asset's keyword/name, composite that asset
// (e.g. the logo) onto the generated image (bottom-right corner). The logo is
// the real uploaded file → pixel-exact (AI image models can't reproduce a logo).
// Best-effort: returns the original image untouched on any miss / fetch / error.
export async function maybeOverlayBrandAsset(
  pageId: string | null | undefined,
  prompt: string,
  imageBase64: string,
): Promise<{ imageData: string; mimeType: string; overlaid: boolean; assetName?: string }> {
  const untouched = { imageData: imageBase64, mimeType: 'image/png', overlaid: false }
  if (!pageId || !prompt?.trim()) return untouched
  try {
    const snap = await adminDb.collection('pages').doc(pageId).collection('brandAssets').get()
    if (snap.empty) return untouched

    const p = prompt.toLowerCase()
    let hit: { name: string; url: string } | null = null
    for (const d of snap.docs) {
      const a = d.data() as { name?: string; keyword?: string; url?: string }
      if (!a.url) continue
      const kw = (a.keyword ?? '').trim().toLowerCase()
      const nm = (a.name ?? '').trim().toLowerCase()
      if ((kw && p.includes(kw)) || (nm && p.includes(nm))) { hit = { name: a.name ?? 'logo', url: a.url }; break }
    }
    if (!hit) return untouched

    const base = Buffer.from(imageBase64, 'base64')
    const meta = await sharp(base).metadata()
    const W = meta.width ?? 1024, H = meta.height ?? 1024

    const logoSrc = Buffer.from(await (await fetch(hit.url)).arrayBuffer())
    const target = Math.max(64, Math.round(W * 0.22))   // ~22% of width
    const logo = await sharp(logoSrc).resize({ width: target, withoutEnlargement: true }).png().toBuffer()
    const lm = await sharp(logo).metadata()
    const margin = Math.round(W * 0.04)

    const out = await sharp(base).composite([{
      input: logo,
      top: Math.max(0, H - (lm.height ?? target) - margin),
      left: Math.max(0, W - (lm.width ?? target) - margin),
    }]).png().toBuffer()

    return { imageData: out.toString('base64'), mimeType: 'image/png', overlaid: true, assetName: hit.name }
  } catch {
    return untouched
  }
}
