---
name: publish-pipeline
description: 載入時機（觀察到的狀態）：要動草稿發布/排程相關 code、發布到 FB/IG/Threads 失敗、限動沒發出去、輪播卡住、或發布成功但學習記錄沒寫。動這塊前也要讀專案 skill `.claude/skills/auto-publish-agent/SKILL.md`。
---

# 發布 Pipeline Playbook（驗證日 2026-07-13）

> **與 `auto-publish-agent` skill 的分工**（別當成重複、也別載錯）：**本 skill＝依症狀除錯發布 pipeline**（發布失敗/限動沒出/輪播卡住/學習記錄沒寫 → 怎麼查怎麼修）。**`auto-publish-agent`＝要「建/改」自動發布功能時的參考**（HITL 關卡、狀態機、各平台尺寸/字數硬限、fallback 鐵則、檔案位置）。動草稿/發布/Meta 寫入相關 code 前兩個都值得讀：先讀 auto-publish-agent 定契約，再用本檔排實際故障。

## 架構事實
- 核心：`lib/content/publishRunner.ts` 的 `runPublish(pageId, draft, platform, byUid)` — **無 LLM**，純編排。手動發布 route 與排程 cron（`/api/cron/publish-scheduled`）共用它，平台邏輯不重複。
- 狀態機：草稿 → 人工核准（HITL）→ 發布/排程 → 記錄 outcome + audit。發布失敗標 `failed`（never silent, never loops）。
- 發布成功會寫**兩種**記錄：outcome/audit（`draftStore`），以及學習訊號（`sidekickFeedback`，`source:'draft'`、docId `draft__{draftId}__{platform}` 冪等）— 改 publishRunner 別把後者弄丟，它是文案學習迴圈的入口（self-learning-loop.md）。
- 發布失敗自動 `reportBug`（per-day 去重）。

## 平台硬坑（全部實戰踩過，memory `project_publish_platform_gotchas`）
| 平台 | 坑 |
|---|---|
| FB | dev mode 下 API 發的**所有內容**僅 App role 可見（config-and-flags.md）；影片會被轉 Reel 且一般人看不到 → dev mode 自動改發封面圖（`useFbCover`）；輪播只支援圖片；Reels 需分段上傳 |
| IG | 容器建立後要**輪詢到 FINISHED** 才能 publish；未連 IG 商業帳號直接擋 |
| Threads | token 解析順序：呼叫者的 → 掃該頁**所有 admin** 的（`getAnyPageThreadsToken`）— 連接者可能不是 owner；留言要等主貼可回覆（~90 秒）且需 manage_replies scope |
| 限動 | 完全隔離：Story 失敗**絕不**連坐主貼文；FB Story 被 flag gate（dev mode 看到黑畫面） |
| 全部 | route 必包 try/catch — 平台 API 隨時丟意外錯誤 |

## FB Login 權限陷阱
FB Login 會**靜默略過**未核准的權限 — 加了新 scope 但行為沒變時，要移除授權重連，不是 code 問題。

## 排錯順序（發布失敗時）
1. 看 audit：`pages/{pid}/contentDrafts/{id}` 的 outcome + audit trail（`publish:{platform}:failed|error` 帶 error 字串）。
2. 對照上表的平台坑。
3. 看 bug 回報（`/dashboard/admin/bugs` 或 `bugReports` collection）— 發布失敗自動進來。
4. 媒體類 route 的 `maxDuration` 是 300（ffmpeg/輪播需要）— 逾時先確認不是砍了這個值。
5. ffmpeg ENOENT → build-and-env.md 的 tracing 事故。

**Done 定義**：localhost 發一篇測試草稿到目標平台成功（FB 可見性用非 App role 帳號驗）、audit 有記錄、`sidekickFeedback` 有 draft 記錄、失敗路徑會出現在 bug 回報頁。

- ❌ 反例（觀察到的合理化）：「FB 發出去了但外部帳號看不到，應該是 Meta 暫時降觸及，等等就好」— 2026-07 已定案這是 dev mode 可見性規則，不是降觸及；等多久都不會出現。

再驗證：`grep -n "draft__\|reportBug\|useFbCover" apps/web/lib/content/publishRunner.ts | head -5`
