// 單一平台 publishResults entry 的組裝規則（純函式，供 draftStore 使用 + 可測）。
//
// ⚠️ 為什麼需要這支：`draftStore.recordPublishOutcome` 用 `set(patch, { merge: true })`
// 寫回，而 Firestore 的 merge 對**巢狀 map 是深合併** —— 就算把 `publishResults[platform]`
// 整包換成沒有 `error` 的新物件，舊的 `error` key 仍會殘留。
// 實例：2026-08-17 Legacy 一篇 IG 先失敗（error: "Fatal"）、8/22 retry 成功後，
// 該 entry 變成 `{ error: "Fatal", postId: "1811…" }` —— error 與 postId 並存。
// 目前判失敗的條件是 `error && !postId` 所以沒出事，但任何寫 `if (r.error)` 的
// 新程式碼都會誤判這篇 IG 失敗。同類事故：linkClicks 深合併殘留。

export interface PlatformFailure { error: string; at: number }

export interface PlatformEntry {
  postId?: string
  permalink?: string
  storyId?: string
  error?: string
  at: number
  failures?: PlatformFailure[]
}

export type PlatformOutcome = { postId?: string; permalink?: string; storyId?: string; error?: string }

/** 一個平台最多保留幾筆失敗歷史。 */
export const MAX_FAILURES = 5

/**
 * 依「上一次的 entry」與「這次的結果」算出要寫回的 entry。
 *
 * - 這次失敗 → 記 `error`，並把這次失敗追加進 `failures`
 * - 這次成功 → **不帶 `error`**（呼叫端須用 FieldValue.delete() 真正刪掉，見 clearedKeys），
 *   同時把上一次殘留的 `error` 搬進 `failures`，失敗歷史不流失
 */
export function buildPlatformEntry(
  prev: PlatformEntry | undefined,
  result: PlatformOutcome,
  now: number,
): { entry: PlatformEntry; clearedKeys: ('error')[] } {
  const failures: PlatformFailure[] = [...(prev?.failures ?? [])]

  if (result.error) {
    failures.push({ error: result.error, at: now })
  } else if (prev?.error) {
    // 上次失敗、這次成功：把舊 error 收進歷史再清掉。
    failures.push({ error: prev.error, at: prev.at ?? now })
  }

  const entry: PlatformEntry = { ...result, at: now }
  if (!result.error) delete entry.error
  if (failures.length) entry.failures = failures.slice(-MAX_FAILURES)

  return { entry, clearedKeys: result.error ? [] : ['error'] }
}
