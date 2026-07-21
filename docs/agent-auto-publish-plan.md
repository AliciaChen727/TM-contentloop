# Agent 自動發布（貼文 → 廣告）規劃

> 規格文件（單一事實來源）。實作前請使用者確認，不自作主張。
> 關聯：`docs/phase-4-ad-automation.md`（廣告寫入）、`docs/phase-3-diagnosis-agent.md`（診斷 Agent + fallback 哲學）、`docs/meta-app-review.md`、CLAUDE.md「診斷引擎」「多粉專資料隔離」段落。

## 0. 已拍板的方向（2026-07-07）

| 決策項 | 結論 |
|--------|------|
| 自主程度 | **L1 — 草稿 + 人工核准**。Agent 生成內容存草稿，每次都要 Admin 按核准才發。之後視信任度再往 L2/L3 開放。 |
| 發布對象順序 | **先貼文（自然內容），後廣告**。貼文風險低（可刪），先驗證整條「生成→草稿→審核→發布→學習」迴圈；廣告（動真錢）留到 Phase 4。 |
| 送審時機 | **先做草稿 + 審核 UI（S1–S3，零 Meta 風險），並行送 App Review**。權限過了再推 S4 發布。 |
| Fallback 哲學 | 沿用診斷 Agent：**LLM 失敗系統不亂發**、Meta 寫入失敗不靜默吞錯、破壞性操作不自動化。 |

---

## 1. 現況盤點（可復用 vs 缺口）

### ✅ 已具備（Agent 直接復用）
- **內容生成**：`api/ai/creative`（文案 brief）、`api/ai/image`（Vertex Imagen + fal）、`api/ai/video`（fal video）。
- **診斷 Agent + fallback**：`lib/ads/diagnosisAgent.ts`（規則偵測 + Haiku 改寫，LLM 掛掉 fallback 回規則模板）。
- **卡片狀態機**：`diagnosisCardStatus`（待處理/已完成/已略過 + 通知尊重狀態）。
- **自我學習**：Quality evaluator + feedback memory + `creative-signal`（Canva 匯入=40／下載=25 權重）。
- **通知/Email**：`processAlerts` / `emailSender`（冪等 per-day、可深連）。
- **cron 基建**：6 支 cron + fingerprint 快取失效。

### ❌ 缺口（本規劃要補）
- 任何對 Meta 的**寫入**（目前全 read-only）。
- 草稿 / 排程 / 發布基建（`contentDrafts`、`optimizationDrafts` 皆未實作）。
- 內容發布（FB/IG 貼文）、廣告寫入（Phase 4）。

---

## 2. 核心迴圈（貼文與廣告共用骨架）

```
① 觸發        ② 生成          ③ 草稿          ④ 人審(HITL)      ⑤ 發布           ⑥ 監控學習
cron/手動  →  Agent 產內容  →  Firestore   →  預覽+diff+核准 →  Meta 寫入      →  成效回收
             (已具備)         草稿+狀態機      /編輯/拒絕         (核准後即時)      → feedback memory
                                             ↑ 強制關卡           ↑ retry/fallback
```

## 3. 自主程度分級（HITL 核心；目前定 L1）

| Level | 行為 | 風險 | 狀態 |
|-------|------|------|------|
| L0 建議 | 只給卡片建議（=現在的診斷卡） | 無 | 已有 |
| **L1 草稿** | Agent 生成 → 存草稿，人一鍵核准後才發 | 低 | **本規劃目標** |
| L2 排程 | 核准後由 cron 在指定時間自動發 | 中 | 未來（貼文可到此級） |
| L3 批次佇列 | Agent 定期自動生成一批，人批次審核 | 中高 | 未來 |
| 永不做 | 全自動無人值守發布 | 高 | ❌ 禁止 |

> 廣告永遠停在 L1（每筆動真錢都要人核准）；貼文未來可放寬到 L2。

## 4. Human-in-the-loop 關卡（每次發布前必過）

1. **預覽 + Diff**：貼文顯示完整卡片預覽（圖+文）；廣告顯示 原文 vs 新文 diff。
2. **明確核准**：草稿預設 `draft`，需 Admin 按核准 → `approved` 才進發布流程；預設絕不自動套用。
3. **權限驗證**：只有該粉專 admin/owner 能核准（viewer 不可），非本頁 admin 看不到草稿（遵守 CLAUDE.md 跨頁隔離）。
4. **核准時效**：草稿 > N 天未發 → `expired`，需重審（避免發到過時內容）。

## 5. Fallback / 防呆機制

| 機制 | 做法 |
|------|------|
| 生成失敗 | LLM 掛 → 不發、留 `failed` 草稿、通知；系統不因 LLM 失靈亂發。 |
| 發布失敗 | Meta 寫入失敗 → 指數退避 retry → 仍失敗標 `failed` + 存 error + 通知，**絕不靜默吞錯**。 |
| 品牌/合規預檢 | 發布前跑規則檢查（禁詞、必要 hashtag、圖片尺寸）+ 可選 LLM 安全複查，不過關擋下。 |
| 冪等去重 | 每草稿一個 `idempotencyKey`，防 cron 重跑重複發同一篇。 |
| Kill Switch | 設定頁一鍵「暫停所有自動化」，立即凍結所有排程/發布。 |
| 靜默時段 | 只在允許時段發（例：白天），避免半夜誤發。 |
| 可回溯 + 稽核 | 每筆記錄 `generatedPrompt` + original + 誰核准 + 時間；出事能追來源、能還原。 |
| 回滾 | 貼文 → 可刪除；廣告 → 只建**新變體/A-B**（不動 live ad），要停就 pause 新變體。 |

## 5.5 平台約束 + 裝置感知 creative（發布前必過）

三件事收斂成同一組「發布前約束」，統一放進 S3 預檢與生成步驟。

### (A) 各平台硬性規格（`lib/publish/platformSpecs.ts`，純常數）

| 平台 | 文字上限 | 圖片建議尺寸 | 影片 / Reels | 其他 |
|------|---------|-------------|------|------|
| **Facebook** | 無硬上限（63,206），但**最佳互動 40–80 字**（過長被折疊） | 1080×1080（1:1）/ 1200×630（1.91:1 連結） | 影片 `/{page}/videos`；**Reels 走獨立端點** `/{page}/video_reels`（9:16，resumable upload） | — |
| **Instagram** | caption 2,200 字、**#hashtag 最多 30 個** | 1080×1350（4:5，動態最佳）/ 1080×1080（1:1）/ Reels 1080×1920（9:16） | `media_type=REELS`（9:16，MP4/MOV，≤15 分）；IG 現在**動態影片一律以 Reels 發布**；Story 用 `media_type=STORIES` | 首行 125 字後被「⋯更多」截斷 |
| **Threads** | **500 字（硬上限）** | 最大寬 1440px、單篇最多 10 張 | `media_type=VIDEO`（≤5 分） | 純文字亦可（`media_type=TEXT`） |

**支援的媒體型態**：純文字（Threads）/ 單圖 / 輪播 carousel / **影片** / **Reels** / Story（IG）。生成端已具備 `api/ai/image` 與 `api/ai/video`。

> 這些是**硬性驗證**：預檢時任一平台超限就擋下（例：同一份文案 IG/FB 過得了，但 Threads 500 字超了 → 標紅，要求為 Threads 出精簡版或不勾 Threads）。

### (A2) ⚠️ 影片/Reels 的非同步發布（與圖片的關鍵差異）
影片不像圖片能秒發，三平台都是「建容器 → **等處理完成** → 才 publish」：
1. 建容器（IG/Threads `media_type=REELS|VIDEO` + 公開 `video_url`；FB Reels 走 resumable upload）。
2. **輪詢容器狀態** `status_code`：`IN_PROGRESS → FINISHED`（失敗 `ERROR/EXPIRED`）。影片處理常需數十秒～數分鐘。
3. 狀態 `FINISHED` 才呼叫 publish；逾時/ERROR → 標 `failed` + 通知（沿用 §5 fallback，不靜默）。
- 因此發布流程要能處理**長任務**：草稿狀態多一個 `processing`（容器建立、等 Meta 轉檔），由 cron 或背景輪詢推進，不阻塞使用者。
- Reels/影片一律 **9:16 直式**，正好對應 §(B) 手機主力受眾的推薦格式。

### (B) 裝置感知 creative 推薦（串接剛完成的 deviceBreakdown）

用廣告的 `deviceBreakdown`（`impression_device`）判斷這個粉專受眾主要用什麼裝置看，讓 Agent 選對「格式 + 文字密度」：

| 受眾裝置主力 | 推薦格式 | 理由 |
|-------------|---------|------|
| **手機為主**（iPhone/Android 手機 佔多數，多數分會屬此） | **直式 4:5 或 9:16** + 文字精簡、字級大、重點前置 | 手機直式佔滿版面、拇指滑動停留短 |
| **平板 / 桌機佔比高** | 方形 1:1 / 橫式 1.91:1 可接受，文字可稍長 | 大螢幕橫式不吃虧 |

- 判斷來源：`deviceBreakdown` 依曝光排序取主力桶（無廣告資料的頁 → 預設「手機為主」，台灣分會多為行動端）。
- Agent 在 §2「生成」步驟就依此**產出平台 × 裝置適配的變體**（例：手機主力 → 直式圖 + 短文；同時為 Threads 出 ≤500 字版）。
- 這是**建議非強制**：推薦格式寫進草稿 `generated.recommendation`，人審時可看到「為什麼推這個尺寸」，仍可自行改。

### (C) 統一驗證函式
`lib/publish/validateDraft.ts`：輸入草稿 + 目標平台 → 回傳 `{ ok, violations: [{ platform, field, limit, actual }] }`。S3 預檢、審核 UI（即時標紅）、發布前最後守門三處共用同一份，單一事實來源。

## 6. 資料模型

```
pages/{pageId}/contentDrafts/{draftId}        # 貼文草稿
  target:        Array<'fb' | 'ig' | 'th'>   // 可多選同時發（Threads 走獨立 API）
  mediaType:     'text' | 'image' | 'carousel' | 'video' | 'reels' | 'story'
  generated:     { prompt, mediaUrl, aspectRatio,   // 影片/Reels 用 9:16
                   perPlatform: {              // 各平台適配版本（字數/尺寸已符合該平台上限）
                     fb?: { body, mediaUrl },
                     ig?: { body, hashtags, mediaUrl },   // hashtags ≤ 30
                     th?: { body },                        // ≤ 500 字
                   },
                   recommendation: { device: 'mobile'|'desktop'|'mixed', format: string, why: string } }
  validation:    { ok: boolean, violations: Array<{platform, field, limit, actual}> }
  schedule:      { mode: 'now' | 'scheduled', at? }
  status:        draft | approved | scheduled | publishing | processing | published | failed | rejected | expired
                 // processing = 影片容器建立中／等 Meta 轉檔（輪詢 status_code）
  approvedByUid: string | null
  publishResult: { postId?: string; error?: string } | null
  idempotencyKey: string
  createdAt / updatedAt

pages/{pageId}/optimizationDrafts/{draftId}   # 廣告草稿（見 phase-4-ad-automation.md §3）

pages/{pageId}/automationSettings/config      # 每頁自主程度 + killSwitch + 靜默時段
  level:      'L1'           // 目前固定 L1
  killSwitch: boolean
  quietHours: { start: number; end: number } | null
  updatedByUid / updatedAt

pages/{pageId}/publishAuditLog/{entryId}      # 稽核：每次核准/發布/失敗一筆
```

## 7. 分階段交付（vertical slice，零風險先行）

| 階段 | 內容 | 需 Meta 寫入權限？ |
|------|------|--------------------|
| **S1 草稿基建** | `contentDrafts` + 狀態機 + 生成→存草稿（串現有 creative/image） | ❌ 可先做 |
| **S2 審核 UI** | 站內草稿頁：預覽/diff/編輯/核准/拒絕 + 權限隔離 + 設定頁自主程度/killSwitch | ❌ 可先做 |
| **S3 平台約束 + 品牌預檢 + fallback** | `platformSpecs` + `validateDraft`（字數/尺寸/hashtag 上限，超限標紅擋下）、裝置感知推薦、禁詞、idempotency、killSwitch、稽核 log | ❌ 可先做 |
| **S4a Threads 發布** | 核准後寫 Threads（`threads_content_publish`，獨立 API，可能免 FB/IG App Review）→ **最快跑通端到端的路徑** | ⚠️ 僅需 Threads scope |
| **S4b FB/IG 發布** | 核准後寫 FB/IG（需 `pages_manage_posts` + `instagram_content_publish`） | ✅ 送審後 |
| **S5 排程（L2）** | cron 在指定時間發已核准草稿 + 靜默時段（貼文才開放） | ✅ |
| **S6 廣告寫入（Phase 4b/4c）** | 沙盒 → 正式建 A/B 新變體 + 成效回寫（`ads_management`） | ✅ |
| **S7 學習迴圈** | 發布後成效回收 → feedback memory，升級 `creative-signal` 的「真的發了」訊號 | ❌ |

**路徑**：先做 S1–S3（純 Firestore + 前端），同時並行送 Meta App Review；過了再推 S4+。

## 8. Meta App Review 需求清單（並行準備）

發布貼文的硬前提。目前 scope 全 read-only（`connect/page.tsx`），需新增：

| 動作 | 需新增 scope | 額外要求 |
|------|-------------|----------|
| 發 **Threads** 貼文 | `threads_content_publish`（Threads API，獨立體系） | 自己帳號 + app admin/tester 在 dev mode 多半可直接用，**不必等 FB/IG App Review**；對外開放才需 Threads 端審查 |
| 發 FB 貼文 | `pages_manage_posts` | App Review |
| 發 IG 貼文 | `instagram_content_publish` | App Review + **Business Verification** |
| 建/改廣告（S6） | `ads_management` | App Review + Business Verification + 沙盒測試 |

送審要備妥：使用情境說明、demo 影片（走完生成→草稿→核准→發布）、隱私政策連結、Business 驗證。準備期以週計。
> 在權限下來前，S1–S3 只到「草稿 + 審核 UI」，不碰任何寫入。
> **Threads 例外**：因走獨立 API 且發自己帳號，S4a 有機會在 FB/IG 審核完成前就先跑通一次真實發布——建議把 Threads 當「端到端驗證的先鋒」。

### Threads 發布流程（`graph.threads.net`，兩步）
1. 建容器：`POST /{threads-user-id}/threads`（`media_type=TEXT|IMAGE|VIDEO` + `text` + 公開 `image_url`/`video_url`）→ 得 `creation_id`。
2. 發布：`POST /{threads-user-id}/threads_publish`（`creation_id`）。
- 限制：250 篇/24h；圖片/影片需公開可存取 URL；token 存於 `users/{uid}/threadsTokens/{pageId}`（沿用現有 Threads 連接）。
- scope 加在 `app/api/auth/threads/authorize/route.ts` 的 `SCOPES`（現為 `threads_basic,threads_manage_insights`），連接者需重新授權一次。

## 9. 驗收標準（S1–S3 先行版）

> **狀態（2026-07-21）**：S1–S5 的**實作已交付**（草稿→核准 HITL→驗證→發布/排程到
> Threads/FB/IG；`lib/publish/publishFb.ts`、`publishIg.ts` 含輪播、Reels resumable、
> 限動；排程由 Firebase Function `publishScheduled` 每 5 分打 `/api/cron/publish-scheduled`）。
> 下列驗收框**尚未逐項正式 QA 打勾**——FB 發布在 dev mode 下僅 App role 可見（見
> `.claude/skills/config-and-flags`、memory `project_publish_platform_gotchas`），完整
> 驗收與 go-live 卡 **Meta App Review + `NEXT_PUBLIC_META_APP_LIVE`**。逐項驗收時再勾。

- [ ] Agent 產出可一鍵存成 `contentDraft`，狀態 `draft`。
- [ ] 草稿頁顯示完整預覽（圖+文）、來源、生成 prompt；可編輯/核准/拒絕。
- [ ] 只有該粉專 admin/owner 能核准；非本頁 admin 看不到草稿（雙粉專交叉測試）。
- [ ] 設定頁有 killSwitch + 自主程度顯示（目前 L1）。
- [ ] 品牌預檢不過關會擋下並提示；每筆核准/發布寫稽核 log。
> S4+ 驗收待 App Review 結果確定後補上。

## 10. 開放問題（待決策）
- 草稿核准時效 N 天 = ？（預設建議 7 天）。
- 靜默時段預設值（預設建議 09:00–21:00）。
- 品牌預檢的禁詞/必要 hashtag 清單由誰維護（每頁設定 vs 全域）。
- IG 發布只支援 image/video/carousel，Reels/Story 另議。
