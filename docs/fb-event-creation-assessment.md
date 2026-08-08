# FB 活動一鍵建立 — 可行性評估與規劃

> 評估日期：2026-08-09
> **技術結論**：純 API 的「一鍵建立 FB 活動」**不可行**（Meta 端點層級封閉，見 §2）。
> **產品決策**：替代方案 Slice A／B **都不做**（活動頻率過低，見 §0）。
> 本文技術結論全部來自 Meta 官方文件原文（附引文），非推測。

## 0. 產品決策：不實作（2026-08-09 定案）

§3–§4 的替代規劃已評估完畢，**決定兩個 slice 都不做**。理由：

| | 數字 |
|---|---|
| 活動頻率 | 一年 **2–3 次** |
| 每場宣傳貼文 | 約 5 則 → 一年 10–15 則草稿 |
| 現況手動成本 | 每則 2–3 分鐘 → **一年不到 1 小時** |
| Slice A+B 開發成本 | 草稿型別／schema／1.91:1 素材管線／新 UI／模板展開，數天，另加三關 + 隔離測試 + 後續維護 |

投報率明顯為負。更關鍵的是：

- **Slice A 省下的比想像中少** —— AI caption 與素材生成**現在就有了**，Slice A 新增的只是「把文案拆成活動欄位」＋複製按鈕，**建立活動的步驟一步都沒少**，人還是要自己到 FB 建。
- **Slice B 沒有新增任何能力** —— 單則草稿排程**現在就能用**（`lib/content/draftStore.ts:173` 的 `schedule.mode='scheduled'` + `functions/src/publishScheduled.ts` cron）。Slice B 只是把「一次建 5 則」變成「輸入一次日期自動展開」，省的是建立動作、不是發布能力。

**現行做法**：活動照舊手動在 FB 建立；宣傳貼文用既有草稿 + 排程功能發。

### 什麼條件下值得重啟

- 活動頻率上升到**每月例會**等級，或開始幫其他粉專**代操活動**（模板化才有規模效益）
- 出現**具體且重複**的痛點（例：活動說明格式每次重想、封面圖尺寸老是被裁到字）
  → 針對該痛點做小改善即可，**不需要整套流程**

> ⚠️ 看到 §3–§4 的規劃時請先讀本節：那些是「若要做，該怎麼做」的技術方案，**不是待辦事項**。

## 1. 需求

使用者希望 ContentLoop 能像現在的「一鍵發布貼文 / 限動」一樣，**一鍵在 FB 粉專建立活動（Event）**，
自動帶入標題、時間、地點、說明與封面圖。

## 2. 結論：Meta 已封閉活動建立 API

### 2.1 Event 節點不支援建立／更新／刪除

`https://developers.facebook.com/docs/graph-api/reference/event/` 原文：

> **Creating** — You can't perform this operation on this endpoint.
> **Updating** — You can't perform this operation on this endpoint.
> **Deleting** — You can't perform this operation on this endpoint.

三個寫入操作全部關閉。這不是權限不足，是端點層級就沒有這個能力。

### 2.2 連「讀取」活動都限 Marketing Partner

同一頁 Limitations：

> Access to Events on Users and Pages is only available to **Facebook Marketing Partners**.

也就是說即使只想把粉專既有活動撈進儀表板顯示，也需要 FMP 資格 —— 那是合作夥伴計畫，不是 App Review 能申請的權限。

### 2.3 `/{page-id}/events` edge 已不存在

- `docs/graph-api/reference/page/events/` → **HTTP 404**
- Page 節點參考頁（83,923 字）的 edge 清單中，`Edge<Event>` 出現 **0 次**，含 events 的 edge 宣告 **0 筆**
  - 對照組：同頁 `Edge<` 出現 **57 次** → 證明比對方法有效，不是搜尋失效造成的假陰性
- `docs/pages-api/` 索引頁全文 **0 個 event 字樣**；`docs/pages-api/events/` → **HTTP 404**

> ⚠️ 方法論註記：第一次量測時 HTML 實體 `&lt;`/`&gt;` 未解碼，導致 `Edge<Event>` 必然回 0（與事實無關的假陰性）。
> 上表是修正解碼並加對照組後重驗的結果。**單靠文件網址 404 不足以斷定 edge 消失**，Meta 會對仍可用的 edge 下架文件頁。

### 2.4 名字像但無關的權限（避免誤判）

| 權限 | 實際用途 | 能建活動？ |
|---|---|---|
| `pages_events` | 回傳購買／加購物車／名單等**廣告轉換事件**（CAPI），供廣告投放優化 | ❌ 完全無關 |
| `instagram_manage_events` | 同上，IG 版的轉換事件回傳 | ❌ 完全無關 |
| `instagram_manage_upcoming_events` | IG「即將到來的活動」，送審要求含「Create a new event... title, date, time, location」 | ⚠️ **IG 限定**，且公開參考文件查無（三個候選網址皆 404）→ 未經證實，且不解決 FB 需求 |

> ⚠️ `pages_events` 這個名字極容易被誤讀成「管理粉專活動」。它是 CAPI。任何日後的評估都不要再被它誤導。

### 2.5 這代表什麼

Phase 4 的「半自動廣告更新」之所以可行，是因為 Marketing API 有完整寫入端點；活動沒有對等的東西。
**這條路不是「等 App Review 就會通」，是 Meta 產品面就沒開。** 不建議投入等待或申訴。

## 3. 替代方案：活動素材包 +「一鍵開啟預填」（半自動）— ⛔ 評估後不做，見 §0

把「不可自動化的最後一步（在 FB 按下建立）」留給人，其餘全部自動化。
使用者實際體感是「填好了、按兩下就完成」，而不是從零開始建活動。

### 3.1 使用者流程

1. 在 `/dashboard/content-drafts` 新增草稿時，把類型選為「活動」
2. AI 依既有 page profile 產出活動欄位：名稱、開始／結束時間、地點、說明文案
3. 封面圖走現有素材管線產出 **1.91:1（1200×628）**（FB 活動封面比例，**不是** 9:16，也**不是** 16:9）
4. 按「建立 FB 活動」→ 開新分頁到 FB 建立活動頁，同時把各欄位放進剪貼簿（分欄位可個別複製）
5. 使用者貼上、確認、送出
6. 回到 ContentLoop 貼上活動連結 → 後續「活動宣傳貼文／限動」直接走**現有發布管線**自動排程

### 3.2 為什麼不是全自動

第 4 步的預填能力有上限：`facebook.com/events/create` 是否支援 query string 預填，**官方無文件、需實測**。
最壞情況退化為「開啟頁面 + 逐欄位複製按鈕」，仍比純手工快很多。**規劃不建立在預填一定可行的假設上。**

### 3.3 真正的價值落點

老實說，活動本身建立只是一次性動作；**重複性勞動在活動的宣傳節奏**（開賣提醒、倒數、當天提醒、會後回顧）。
現有發布管線（`lib/content/publishRunner.ts`）已經支援 FB／IG／Threads 全平台排程，
把「活動宣傳排程模板」做起來的效益，遠高於硬要自動化建立活動那一步。

## 4. 實作範圍（若日後重啟才適用，見 §0）

### Slice A — 活動素材包（先做，價值高風險低）

| 項目 | 檔案 | 說明 |
|---|---|---|
| 草稿類型加 `event` | `lib/content/` 型別與 schema | 沿用現有 draft 結構，新增 `eventMeta`（name/start/end/place/description/coverUrl） |
| AI 產活動欄位 | 沿用 `api/ai/creative` 模式 | 產出結構化欄位而非純文案；model 用 `claude-haiku-4-5` |
| 活動封面 | 沿用 `lib/media/composeAudio.ts` 的 `to916Canvas` 手法，另寫 `to191Canvas`（1200×628） | ⚠️ 活動封面是 **1.91:1**，不可直接複用 9:16 畫布。實作前先到 FB Help Center「Add a cover photo to your Facebook event」再確認一次現行建議值，確認後才定案函式命名 |
| 建立活動頁面 UI | `components/content/` 新元件（<200 行） | 逐欄位複製按鈕 + 開啟 FB 建立活動分頁 |
| 預填實測 | — | 先手動測 `facebook.com/events/create` 的 query 預填，結果決定 UI 深度 |

### Slice B — 活動宣傳排程模板（效益最大）

活動連結存回草稿後，一鍵展開一組預設排程貼文（T-14 預告／T-7／T-1 提醒／當天／會後回顧），
全部走既有 `publishRunner` + 排程機制，不需要任何新的 Meta 權限。

### 4.1 不需要新權限

Slice A／B 都不碰任何新的 Meta 權限，**不影響現有 App Review 狀態**，也不需要重新授權。
這是選這條路線的重要理由之一。

## 5. 驗證方式

1. **預填實測**（做 Slice A 前的前置）：手動開 `facebook.com/events/create` 帶各種 query 參數，記錄哪些欄位吃得到
2. **封面比例**：產出的 1.91:1 圖上傳 FB 活動，確認沒有被裁切到重要文字（1.91:1 來自搜尋結果普遍引用的 1200×628，**尚未取得 Meta 官方頁面原文**，屬本文件中唯一未經一手驗證的數字）
3. **隔離測試**：用同時管理 D67 + Legacy 的帳號，確認活動草稿與素材不跨粉專（見 `feedback_page_isolation`）
4. **三關**：`npx tsc --noEmit` + `npx eslint` + `npm run build`
5. **localhost 驗收**：依 `feedback_deploy_flow`，先在 localhost 給使用者測過才 commit

## 6. 若仍想要全自動 —— 唯一的路

成為 **Facebook Marketing Partner**。這是商業合作資格（有營收／客戶規模門檻），
不是技術問題，也不是 App Review 流程。以 ContentLoop 目前階段不建議投入。

## 7. 參考

- Event 節點：https://developers.facebook.com/docs/graph-api/reference/event/
- 權限總表：https://developers.facebook.com/docs/permissions/
- 現有發布管線：`apps/web/lib/content/publishRunner.ts`
- 素材產製：`apps/web/lib/media/composeAudio.ts`
