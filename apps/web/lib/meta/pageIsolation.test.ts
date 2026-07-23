import { describe, it, expect } from 'vitest'
import {
  belongsToAnyPrefix, keepIdsForPrefixes,
  shortStoryId, matchesPageStory, matchesIgStory, creativeBelongsToPage, type PageMatchContext,
} from './pageIsolation'

// Canonical live page ids (see .claude/skills/UNCERTAINTY.md). The real 2026-07
// incident #1 was a legacy fallback that MERGED both pages' docs — this fixture
// reproduces that mixed two-page input and asserts only the target survives.
const LEGACY = '235543696463178'
const D67 = '874392279086513'

describe('belongsToAnyPrefix', () => {
  it('matches a doc id carrying the page prefix', () => {
    expect(belongsToAnyPrefix(`${LEGACY}_10001`, [LEGACY])).toBe(true)
  })

  it('rejects another page id even when the number appears as a substring', () => {
    // D67 doc must never match Legacy — the exact failure that leaked data.
    expect(belongsToAnyPrefix(`${D67}_20002`, [LEGACY])).toBe(false)
  })

  it('requires the underscore boundary (prefix must be followed by "_")', () => {
    // A page whose id is a prefix of another must not match without the "_".
    expect(belongsToAnyPrefix(`${LEGACY}9_x`, [LEGACY])).toBe(false)
  })

  it('matches when any of several prefixes fits (e.g. pageId OR igUserId)', () => {
    const igUserId = '17841400000000000'
    expect(belongsToAnyPrefix(`${igUserId}_media`, [D67, igUserId])).toBe(true)
  })

  it('returns false for empty / null / undefined id', () => {
    expect(belongsToAnyPrefix('', [LEGACY])).toBe(false)
    expect(belongsToAnyPrefix(null, [LEGACY])).toBe(false)
    expect(belongsToAnyPrefix(undefined, [LEGACY])).toBe(false)
  })

  it('never matches when the prefix list is empty or blank (no accidental pass-through)', () => {
    expect(belongsToAnyPrefix(`${LEGACY}_10001`, [])).toBe(false)
    expect(belongsToAnyPrefix(`${LEGACY}_10001`, [''])).toBe(false)
  })
})

describe('keepIdsForPrefixes (the shape that broke in incident #1)', () => {
  it('drops the other page from a mixed two-page list', () => {
    const mixed = [`${LEGACY}_a`, `${D67}_b`, `${LEGACY}_c`, `${D67}_d`]
    expect(keepIdsForPrefixes(mixed, [LEGACY])).toEqual([`${LEGACY}_a`, `${LEGACY}_c`])
    expect(keepIdsForPrefixes(mixed, [D67])).toEqual([`${D67}_b`, `${D67}_d`])
  })

  it('returns [] when no id matches', () => {
    expect(keepIdsForPrefixes([`${D67}_b`], [LEGACY])).toEqual([])
  })
})

// Ad-creative → page matching (extracted from api/ads/sync/route.ts:matchesPage/Ig).
const LEGACY_IG = '17841400000000001'
const D67_IG = '17841400000000002'
const legacyCtx: PageMatchContext = {
  pagePrefixes: [LEGACY],
  fbMediaIds: new Set(['legacyFbPost1']),
  igUserId: LEGACY_IG,
  igMediaIds: new Set(['legacyIgMedia1']),
}

describe('shortStoryId', () => {
  it('strips the leading {prefix}_ from a story id', () => {
    expect(shortStoryId(`${LEGACY}_1144183372104577`)).toBe('1144183372104577')
  })
  it('returns the id unchanged when there is no underscore', () => {
    expect(shortStoryId('legacyFbPost1')).toBe('legacyFbPost1')
  })
})

describe('matchesPageStory', () => {
  it('matches a story id carrying the page prefix', () => {
    expect(matchesPageStory(`${LEGACY}_999`, legacyCtx)).toBe(true)
  })
  it('rejects another page (D67) prefix', () => {
    expect(matchesPageStory(`${D67}_999`, legacyCtx)).toBe(false)
  })
  it('matches by known FB post id even when the story prefix is an old/other page id (New Page Experience)', () => {
    expect(matchesPageStory('108000000000000_legacyFbPost1', legacyCtx)).toBe(true)
  })
  it('matches when the whole story id is a known FB post id (no underscore)', () => {
    expect(matchesPageStory('legacyFbPost1', legacyCtx)).toBe(true)
  })
  it('returns false for undefined / non-string', () => {
    expect(matchesPageStory(undefined, legacyCtx)).toBe(false)
  })
})

describe('matchesIgStory — the igUserId branch (deferred from B1)', () => {
  it('matches a story id carrying this page IG account prefix', () => {
    expect(matchesIgStory(`${LEGACY_IG}_abc`, legacyCtx)).toBe(true)
  })
  it("rejects another page's IG account prefix", () => {
    expect(matchesIgStory(`${D67_IG}_abc`, legacyCtx)).toBe(false)
  })
  it('matches by known IG media id regardless of prefix', () => {
    expect(matchesIgStory('anything_legacyIgMedia1', legacyCtx)).toBe(true)
  })
  it('with no igUserId set, only known IG media ids match (prefix branch is skipped, no crash)', () => {
    const noIg: PageMatchContext = { ...legacyCtx, igUserId: undefined }
    expect(matchesIgStory(`${LEGACY_IG}_abc`, noIg)).toBe(false)      // prefix branch skipped
    expect(matchesIgStory('x_legacyIgMedia1', noIg)).toBe(true)       // media-id branch still works
  })
})

describe('creativeBelongsToPage — combined FB + IG match (the shape used in the ads sync filter)', () => {
  it('matches via the FB story id', () => {
    expect(creativeBelongsToPage(`${LEGACY}_1`, undefined, legacyCtx)).toBe(true)
  })
  it('matches via the IG story id when the FB story id is absent', () => {
    expect(creativeBelongsToPage(undefined, `${LEGACY_IG}_m`, legacyCtx)).toBe(true)
  })
  it('returns false when both story ids are absent', () => {
    expect(creativeBelongsToPage(undefined, undefined, legacyCtx)).toBe(false)
  })

  it('ISOLATION: a D67 creative (D67 FB + D67 IG story ids) never matches the Legacy page', () => {
    expect(creativeBelongsToPage(`${D67}_1`, `${D67_IG}_m`, legacyCtx)).toBe(false)
  })
  it('ISOLATION: the reverse — a Legacy creative never matches a D67 context', () => {
    const d67Ctx: PageMatchContext = {
      pagePrefixes: [D67], fbMediaIds: new Set(['d67FbPost']), igUserId: D67_IG, igMediaIds: new Set(['d67IgMedia']),
    }
    expect(creativeBelongsToPage(`${LEGACY}_1`, `${LEGACY_IG}_m`, d67Ctx)).toBe(false)
  })
})
