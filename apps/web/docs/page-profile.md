# Page Profile（產業 + 廣告目標）

支援「同一個 admin 管多個產業的粉專」的兩層 profile 架構。

## 兩層儲存

| 層級 | 路徑 | 適用情境 |
|---|---|---|
| 使用者預設（fallback） | `users/{uid}.onboardingData` | 第一次登入 onboarding 設定的個人預設值 |
| 粉專覆寫（override） | `pages/{pageId}/profile/profile` | 該粉專專屬的產業與目標；存在時優先使用 |

兩個欄位：
```ts
{
  optimizationGoal: 'clicks' | 'conversion' | 'reach' | 'event'
  industry: 'ecommerce' | 'education' | 'event' | 'personal_brand' | 'other'
}
```

> 型別與 valid list 都集中在 `apps/web/lib/profile-types.ts`，任何新增 enum 值都從這裡擴充即可。

## 解析優先序（resolver）

`apps/web/lib/page-profile.ts` 的 `resolvePageProfile(uid, pageId)`：

1. 若 `pageId` 提供且 `pages/{pageId}/profile/profile` 有設定 → 用粉專層級（`source: 'page'`）
2. 否則讀 `users/{uid}.onboardingData` → 用使用者預設（`source: 'user'`）
3. 都沒有 → `source: 'none'`，欄位皆 null

`ResolvedProfile.source` 讓 UI 可以顯示「目前使用粉專覆寫」或「使用個人預設」。

## API

| Method | 路徑 | 權限 |
|---|---|---|
| GET | `/api/user/onboarding` | 本人 |
| POST | `/api/user/onboarding` | 本人 |
| GET | `/api/pages/{pageId}/profile` | `pages/{pageId}/admins/{uid}` 存在才行 |
| POST | `/api/pages/{pageId}/profile` | 同上 |

POST 支援部分更新：只傳 `optimizationGoal` 就只改該欄位。傳 `null` = 刪除該欄位 → 回退到使用者預設。

## 隔離規則（必讀）

- 粉專層級 profile 是 page-scoped 資料 → 必經 `verifyPageAdmin(uid, pageId)`，與 `ads/labels`、`ads/abtest` 等 endpoint 同 pattern。
- Sidekick / 儀表板 KPI 排序若要支援多粉專場景，**永遠透過 `resolvePageProfile(uid, pageId)`**，不要直接讀 `users/{uid}.onboardingData`。
- 詳見 CLAUDE.md「Legacy Collection 隔離規則」與「OAuth User-Centric 架構」。

## 目前已接入

- `/api/ai/sidekick`：已改用 `resolvePageProfile`，system prompt 會標註資料來源（page 或 user）

## 還沒做（後續 UI）

- 設定頁的「per-page profile」選擇器（建議放在 `/dashboard/settings` 或新的 `/dashboard/pages/{pageId}` 頁面）
- `OverviewSection` 的 KPI 排序改讀 page-level（目前讀 user-level，行為仍正確，但多粉專時不會分產業）
- 一次性 backfill：把現有 user-level 設定複製到使用者唯一的粉專（如果只有一個的話）
