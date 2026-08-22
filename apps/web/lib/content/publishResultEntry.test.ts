import { describe, it, expect } from 'vitest'
import { buildPlatformEntry, MAX_FAILURES, type PlatformEntry } from './publishResultEntry'

const NOW = 1_787_400_000_000

describe('buildPlatformEntry', () => {
  it('首次成功：沒有 error、沒有 failures', () => {
    const { entry, clearedKeys } = buildPlatformEntry(undefined, { postId: 'p1', permalink: 'u' }, NOW)
    expect(entry).toEqual({ postId: 'p1', permalink: 'u', at: NOW })
    expect('error' in entry).toBe(false)
    expect(clearedKeys).toEqual(['error'])   // 仍要求呼叫端刪除，深合併才不會殘留
  })

  it('首次失敗：記 error 並開始累積 failures', () => {
    const { entry, clearedKeys } = buildPlatformEntry(undefined, { error: 'Fatal' }, NOW)
    expect(entry.error).toBe('Fatal')
    expect(entry.failures).toEqual([{ error: 'Fatal', at: NOW }])
    expect(clearedKeys).toEqual([])
  })

  // 2026-08-17 → 8/22 的真實序列：IG 先 Fatal，retry 後成功。
  // 修復前 Firestore 變成 { error:'Fatal', postId:'1811…' } 兩者並存。
  it('失敗後重試成功：清掉 error，但失敗歷史留下來', () => {
    const prev: PlatformEntry = { error: 'Fatal', at: 1_786_932_072_754 }
    const { entry, clearedKeys } = buildPlatformEntry(prev, { postId: '18119097439896384', permalink: 'https://ig/p/x' }, NOW)

    expect('error' in entry).toBe(false)                    // ← 誤導的 error 消失
    expect(entry.postId).toBe('18119097439896384')
    expect(entry.failures).toEqual([{ error: 'Fatal', at: 1_786_932_072_754 }])  // ← 但沒被遺忘
    expect(clearedKeys).toEqual(['error'])                  // ← 呼叫端要用 FieldValue.delete()
  })

  it('連續失敗會累積，且沿用先前歷史', () => {
    const prev: PlatformEntry = { error: '第一次', at: 1, failures: [{ error: '第一次', at: 1 }] }
    const { entry } = buildPlatformEntry(prev, { error: '第二次' }, NOW)
    expect(entry.failures).toEqual([{ error: '第一次', at: 1 }, { error: '第二次', at: NOW }])
  })

  it(`failures 上限 ${MAX_FAILURES} 筆，保留最新的`, () => {
    const failures = Array.from({ length: MAX_FAILURES }, (_, i) => ({ error: `e${i}`, at: i }))
    const { entry } = buildPlatformEntry({ error: 'e4', at: 4, failures }, { error: '最新' }, NOW)
    expect(entry.failures).toHaveLength(MAX_FAILURES)
    expect(entry.failures!.at(-1)).toEqual({ error: '最新', at: NOW })
    expect(entry.failures!.at(0)).toEqual({ error: 'e1', at: 1 })   // 最舊的被擠掉
  })

  it('成功再成功（補發限動）不會憑空生出 failures', () => {
    const prev: PlatformEntry = { postId: 'p1', at: 1 }
    const { entry } = buildPlatformEntry(prev, { postId: 'p1', storyId: 's1' }, NOW)
    expect(entry.failures).toBeUndefined()
    expect(entry.storyId).toBe('s1')
  })

  it('舊 entry 沒有 at 時不會寫進 NaN/undefined', () => {
    const prev = { error: '舊錯誤' } as PlatformEntry
    const { entry } = buildPlatformEntry(prev, { postId: 'p' }, NOW)
    expect(entry.failures).toEqual([{ error: '舊錯誤', at: NOW }])
  })
})
