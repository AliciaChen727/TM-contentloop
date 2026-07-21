import { describe, it, expect } from 'vitest'
import { belongsToAnyPrefix, keepIdsForPrefixes } from './pageIsolation'

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
