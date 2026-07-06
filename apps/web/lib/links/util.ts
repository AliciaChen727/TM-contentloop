// Helpers for the short-link / click-tracking feature (Phase A: click tracking).
import { createHash } from 'crypto'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no 0/o/1/l to avoid confusion

// Random base-32 slug. 7 chars ≈ 34 trillion combos — collision risk is
// negligible at a club's scale; the create API still re-rolls on the rare clash.
export function genSlug(len = 7): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

// Link-preview / messenger crawlers that fetch a URL when it's pasted — these
// must NOT count as real human clicks, or FB/LINE previews inflate the numbers.
const BOT_PATTERNS = [
  'facebookexternalhit', 'facebookcatalog', 'meta-externalagent',
  'line-poker', 'linespider', 'whatsapp', 'telegrambot', 'twitterbot',
  'slackbot', 'discordbot', 'bingbot', 'googlebot', 'applebot',
  'bot', 'crawler', 'spider', 'preview', 'curl', 'wget', 'python-requests', 'headless',
]
export function isBotUA(ua: string): boolean {
  const u = (ua || '').toLowerCase()
  return BOT_PATTERNS.some(p => u.includes(p))
}

// Coarse device/UA label for the click log (no fingerprinting, just a category).
export function uaCategory(ua: string): string {
  const u = (ua || '').toLowerCase()
  // Split by device (not just OS) so the links page distinguishes phone vs tablet,
  // aligned with the Meta ads `impression_device` labels. Check iPad before iPhone;
  // Android phones carry the "mobile" token, tablets don't.
  if (/ipad/.test(u)) return 'iPad'
  if (/iphone|ipod/.test(u)) return 'iPhone'
  if (/android/.test(u)) return /mobile/.test(u) ? 'Android 手機' : 'Android 平板'
  if (/macintosh|mac os/.test(u)) return 'Mac'
  if (/windows/.test(u)) return 'Windows'
  if (/linux/.test(u)) return 'Linux'
  return 'Other'
}

// Privacy (PDPA): never store a raw IP. Hash it with a server-side salt so we can
// still de-dupe rapid double-hits without keeping identifiable data.
export function hashIp(ip: string): string {
  const salt = process.env.LINK_IP_SALT ?? 'contentloop-link-salt'
  return createHash('sha256').update(`${salt}:${ip || 'unknown'}`).digest('hex').slice(0, 16)
}

// Validate a user-supplied destination URL (must be http/https, reject the rest).
export function isValidDestination(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}
