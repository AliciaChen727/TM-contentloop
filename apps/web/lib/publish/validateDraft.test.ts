import { describe, it, expect } from 'vitest'
import { validateItems, hasBlockingErrors, type ValidationItem } from './validateDraft'

// A valid image post per platform, overridable per test.
const item = (over: Partial<ValidationItem> & { platform: ValidationItem['platform'] }): ValidationItem => ({
  text: 'hello world',
  hashtags: [],
  hasMedia: true,
  mediaType: 'image',
  ...over,
})

const codes = (items: ValidationItem[]) => validateItems(items).map(v => v.code)

describe('validateItems — required fields', () => {
  it('flags empty caption as a blocking error', () => {
    const v = validateItems([item({ platform: 'fb', text: '   ' })])
    expect(v.map(x => x.code)).toContain('empty')
    expect(v[0].severity).toBe('error')
  })

  it('IG requires media — text-only IG post is a blocking error', () => {
    expect(codes([item({ platform: 'ig', hasMedia: false, mediaType: 'text' })])).toContain('media_required')
  })

  it('FB allows text-only (no media_required)', () => {
    expect(codes([item({ platform: 'fb', hasMedia: false, mediaType: 'text' })])).not.toContain('media_required')
  })

  it('non-text media type with no uploaded asset → media_missing', () => {
    expect(codes([item({ platform: 'fb', mediaType: 'image', hasMedia: false })])).toContain('media_missing')
  })
})

describe('validateItems — caps', () => {
  it('IG caption over 2,200 chars is a blocking error', () => {
    expect(codes([item({ platform: 'ig', text: 'x'.repeat(2201) })])).toContain('text_max')
  })

  it('IG caption at exactly 2,200 chars is allowed', () => {
    expect(codes([item({ platform: 'ig', text: 'x'.repeat(2200) })])).not.toContain('text_max')
  })

  it('Threads over 500 chars does NOT error (auto-splits into a reply chain)', () => {
    expect(codes([item({ platform: 'th', text: 'x'.repeat(2000) })])).not.toContain('text_max')
  })

  it('IG over 30 hashtags is a blocking error', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`)
    expect(codes([item({ platform: 'ig', hashtags: tags })])).toContain('hashtag_max')
  })

  it('FB has no hard hashtag cap (40 tags is fine)', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `t${i}`)
    expect(codes([item({ platform: 'fb', hashtags: tags })])).not.toContain('hashtag_max')
  })
})

describe('validateItems — FB carousel media rules', () => {
  it('mixed photo + video carousel → warn (fb_mixed_carousel), not blocking', () => {
    const v = validateItems([item({ platform: 'fb', mediaType: 'carousel', mediaUrls: ['a.jpg', 'b.mp4'] })])
    const mixed = v.find(x => x.code === 'fb_mixed_carousel')
    expect(mixed?.severity).toBe('warn')
  })

  it('all-video carousel → blocking error (fb_video_carousel)', () => {
    const v = validateItems([item({ platform: 'fb', mediaType: 'carousel', mediaUrls: ['a.mp4', 'b.mov'] })])
    const bad = v.find(x => x.code === 'fb_video_carousel')
    expect(bad?.severity).toBe('error')
  })

  it('all-photo carousel is fine', () => {
    expect(codes([item({ platform: 'fb', mediaType: 'carousel', mediaUrls: ['a.jpg', 'b.png'] })])).toEqual([])
  })
})

describe('validateItems — banned words + happy path', () => {
  it('banned word is a warning, not a block', () => {
    const v = validateItems([item({ platform: 'fb', text: 'buy our SCAM now' })], { bannedWords: ['SCAM'] })
    const b = v.find(x => x.code === 'banned')
    expect(b?.severity).toBe('warn')
    expect(hasBlockingErrors(v)).toBe(false)
  })

  it('a clean IG image post produces no violations', () => {
    expect(validateItems([item({ platform: 'ig', text: 'nice', hashtags: ['a', 'b'] })])).toEqual([])
  })
})

describe('hasBlockingErrors', () => {
  it('true when any error present, false when only warnings', () => {
    expect(hasBlockingErrors([{ platform: 'fb', field: 'text', code: 'empty', severity: 'error', message: '' }])).toBe(true)
    expect(hasBlockingErrors([{ platform: 'fb', field: 'text', code: 'banned', severity: 'warn', message: '' }])).toBe(false)
    expect(hasBlockingErrors([])).toBe(false)
  })
})
