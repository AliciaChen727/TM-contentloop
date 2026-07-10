# AI 草稿標記功能計畫

日期：2026-07-10

## 目標

在 AI 草稿發布流程中加入「已知名單」標記能力，讓 Admin / Editor 在建立草稿時，可以從 ContentLoop 已知名單選擇：

- Facebook：插入個人姓名、標記地點
- Instagram：在 caption 追加 `@username`、標記地點
- Threads：標記地點

發布仍沿用既有權限：Editor 可建立/編輯草稿與選擇標記；真正發布、排程、核准仍由 Admin / Owner 控制。

## 權限邊界

- Viewer 不可使用草稿與標記管理 API。
- Admin / Editor 可讀取、同步、建立標記名單，並在草稿中套用。
- Admin / Owner 才能核准、排程、發布、刪除草稿。
- 所有 API 都必須以 `pageId` 驗 `content.draft` 或 `content.publish`，不可讀無 page-scoped 的 legacy collection。

## 資料模型

標記名單存於：

```text
pages/{pageId}/taggableEntities/{entityId}
```

欄位：

```ts
{
  type: 'person' | 'page' | 'location',
  displayName: string,
  fbUserId?: string,
  fbPageId?: string,
  igUsername?: string,
  locationId?: string,
  enabledPlatforms: ('fb' | 'ig' | 'th')[],
  source: 'historical_post_tag' | 'post_place' | 'ig_caption' | 'commenter' | 'manual',
  confidence: 'ready' | 'needs_verification',
  disabled?: boolean,
  createdBy?: string,
  lastSeenAt?: number,
  createdAt?: number,
  updatedAt: number
}
```

草稿新增：

```ts
tagging?: {
  fb?: {
    pageMentions?: string[]
    personTags?: string[]
    place?: string
  },
  ig?: {
    mentions?: string[]
    location?: string
  },
  th?: {
    location?: string
  }
}
```

## 來源策略

第一版只使用 ContentLoop 已知資料，不嘗試抓完整 follower 清單。

可同步來源：

- `users/{ownerUid}/pages/{pageId}/igPosts`：從 caption 擷取 `@username`
- `users/{ownerUid}/pages/{pageId}/fbPosts`：若既有資料含 `message_tags` / `tags` / `place`，同步為 FB 標記或地點
- Graph API 回補近期 FB posts：用 owner Page token 嘗試抓 `message_tags` / `tags` / `place` / `comments.from`
- 未來可加入：私訊互動者、手動匯入名單、Graph API paging 深度回補

Follower 名單限制：

- Meta Graph API 一般只提供粉專/IG 的 follower 數量或洞察，不提供完整 follower 身分清單。
- 因此 follower list 不能直接作為標記名單來源。
- 若 follower 曾留言、被歷史文章標記、在 caption 被 @、或透過登入/匯入進入 ContentLoop，才可成為 `taggableEntities`。

Facebook 名單限制：

- FB 個人名單目前只用於插入姓名。
- FB Page post 透過 Graph API 發布時，ContentLoop 目前不支援讓個人姓名變成 clickable profile link，也不支援真正個人 tag。實測即使使用歷史貼文中的 FB user ID，Meta 仍可能只把文案中的姓名顯示為純文字。
- 因此 FB 個人項目在產品上只作為「插入姓名」：使用者可從已知名單選人，系統把顯示名稱放進文案，但發布時不送 `tags` 參數。
- FB 粉專名稱不提供選取或自動插入；若需要提到粉專，使用者自行在文案中輸入純文字。
- FB 地點仍可用 `place=locationId`。
- IG username 不能直接轉成 FB 個人 tag。
- `#hashtag` 不是個人或粉專 ID；同步與手動建立名單時都必須排除。
- 若同步後 FB 區塊為空，通常代表目前已存歷史貼文與 Graph API 回補都沒有取得 `message_tags` / `tags` / `place` 等欄位；可改用手動匯入正確 FB ID。
- 第一版 UI 不提供手動搜尋/加入 FB 個人 profile tag；Meta Graph API 不支援可靠用 FB 個人姓名或 username 搜尋，numeric ID 對一般使用者也不易取得。
- 留言者 `comments.from` 會先以 `confidence='needs_verification'` 存成候選人；這類 ID 不直接用於 Page post `tags`。

## Composer UX

- 文案 textarea 支援輸入 `@` 後搜尋目前平台可用的已知名單。
- 選取項目後會插入文字，並同步加入草稿 `tagging`。
- textarea 下方顯示已選 chips，讓使用者看得出是否已套用粉專/地點標記或姓名插入。
- 「進階標記」區仍提供完整多選與地點選擇，作為精準編輯入口。
- IG 可在 `@` 搜尋時，或在「進階標記」區手動新增 `@username` 到名單。
- FB 個人只作為「插入姓名」。`@` 搜尋或「進階標記」選取時，系統插入顯示名稱並用 chip 顯示；UI 必須說明因 Meta 限制，不支援 profile link 或真正 tag。

## 發布轉換

Facebook：

- 個人姓名：只插入純文字顯示名稱；發布時不傳 `tags`
- 地點：發 feed/photo/carousel 時傳 `place=locationId`

Instagram：

- 帳號標記：若文案尚未包含 `@username`，發布前追加到 caption
- 地點：建立 media container 時傳 `location_id`
- 第一版不做圖片座標式 `user_tags`

Threads：

- 地點：建立 root container 時傳 `location_id`

## 驗證規則

Server side 必須檢查：

- entity 必須存在於同一個 `pages/{pageId}/taggableEntities`
- entity 不可 disabled
- entity 的 `enabledPlatforms` 必須包含目標平台
- FB 插入姓名必須 `type='person'` 且 `confidence='ready'`，但不轉成 Meta `tags`
- IG mention 必須有 `igUsername`
- location 必須有 `locationId`
- 若草稿 target 不包含某平台，不可提交該平台的 tagging
