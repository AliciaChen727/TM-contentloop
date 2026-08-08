/**
 * 粉專分類資料夾 — 純顯示用的分組，讓粉專切換選單不再是一長串平鋪清單。
 *
 * ⚠️ 這與 docs/multi-tenant-rbac.md §2.3 的 `groups/{groupId}` 是**兩件不同的事**：
 *   - Group（Stage D，尚未實作）＝ 批次「授權」，決定誰能看哪些粉專。
 *   - Folder（本檔）＝ 純「顯示」分類，只影響選單排版，**完全不影響權限**。
 *   命名刻意不同，避免日後誤以為 Stage D 已實作一半。
 *
 * 儲存位置：users/{uid}/settings/pageFolders（per-user 偏好，跨裝置一致）。
 * 目前沒有設定 UI，資料以腳本寫入；日後要加設定頁時只需寫同一份 doc。
 */

export interface PageFolder {
  id: string
  name: string
  pageIds: string[]
}

/** 一個分組後的區塊。name 為 null 代表「不分組」（行為與加此功能前完全相同）。 */
export interface PageBucket<T> {
  name: string | null
  pages: T[]
}

/** Firestore 讀回來的資料可能是任意形狀，收斂成可信的 PageFolder[]。 */
export function normalizeFolders(raw: unknown): PageFolder[] {
  if (!Array.isArray(raw)) return []
  const out: PageFolder[] = []
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const pageIds = Array.isArray(o.pageIds) ? o.pageIds.filter((x): x is string => typeof x === 'string') : []
    if (!id || !name) continue
    out.push({ id, name, pageIds })
  }
  return out
}

/**
 * 把粉專清單依 folders 分桶。
 *
 * 規則：
 * - 依 folders 給定的順序輸出，桶內粉專維持 `pages` 原本的順序（來源順序才是權威）。
 * - 一個粉專只會出現在**第一個**符合的 folder —— 選單裡出現重複項目會讓人選錯粉專。
 * - 沒被分到的粉專放最後一桶「其他」；若完全沒有任何 folder 命中，回傳單一無名稱桶
 *   （＝維持原本的平鋪清單，不會憑空多出一個「其他」標題）。
 * - 空的 folder 不輸出，避免選單出現只有標題沒有項目的區塊。
 */
export function groupPages<T extends { pageId: string }>(
  pages: T[],
  folders: PageFolder[],
  otherLabel = '其他',
): PageBucket<T>[] {
  if (!folders.length) return [{ name: null, pages }]

  // pageId → 第一個命中的 folder index
  const owner = new Map<string, number>()
  folders.forEach((f, i) => {
    for (const pid of f.pageIds) if (!owner.has(pid)) owner.set(pid, i)
  })

  const buckets: T[][] = folders.map(() => [])
  const rest: T[] = []
  for (const p of pages) {
    const i = owner.get(p.pageId)
    if (i === undefined) rest.push(p)
    else buckets[i].push(p)
  }

  const out: PageBucket<T>[] = []
  folders.forEach((f, i) => {
    if (buckets[i].length) out.push({ name: f.name, pages: buckets[i] })
  })
  // 完全沒命中 → 維持原樣平鋪，不加標題
  if (!out.length) return [{ name: null, pages }]
  if (rest.length) out.push({ name: otherLabel, pages: rest })
  return out
}
