'use client'

/**
 * 粉專選單的 <option> 群組渲染 — 給各儀表板頁的原生 <select> 共用。
 *
 * 沒有分類（folders 空）時輸出與原本完全相同的一串 <option>，
 * 有分類時才包成 <optgroup>。純顯示，不影響權限（見 lib/pages/pageFolders.ts）。
 */

import { groupPages, type PageFolder } from '@/lib/pages/pageFolders'

interface Props<T extends { pageId: string }> {
  pages: T[]
  folders: PageFolder[]
  /** 顯示文字（各頁習慣不同，例如 links 頁用 pageName || pageId）。 */
  labelOf: (p: T) => string
  otherLabel?: string
}

export function PageOptions<T extends { pageId: string }>({ pages, folders, labelOf, otherLabel }: Props<T>) {
  const buckets = groupPages(pages, folders, otherLabel)

  // 未分組 → 維持原本的平鋪 <option>，不包 optgroup
  if (buckets.length === 1 && buckets[0].name === null) {
    return <>{pages.map(p => <option key={p.pageId} value={p.pageId}>{labelOf(p)}</option>)}</>
  }

  return (
    <>
      {buckets.map(b => (
        <optgroup key={b.name ?? '_'} label={b.name ?? ''}>
          {b.pages.map(p => <option key={p.pageId} value={p.pageId}>{labelOf(p)}</option>)}
        </optgroup>
      ))}
    </>
  )
}
