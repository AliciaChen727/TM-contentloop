# Phase 3C — ChatOps：從 Telegram / Discord / Teams 下指令給 Agent

> **定位**：Phase 3B（Bug 回報 Slice 18 + Bug 修復 agent Slice 19）的**前端延伸**。
> 我們**不是重新做 agent**——偵測、回報、修 code、開 PR、雙重 HITL 都已經有了。
> 這一階段只加兩件事：**(a) 一個聊天前端**、**(b) 一台常駐主機**來跑它。
> **參考架構**：[OpenAB](https://github.com/openabdev/openab)（MIT，Rust ACP broker，橋接 Discord/Slack/Telegram/Teams… ↔ Claude Code 等 coding CLI）。
> **狀態**：規劃中，待使用者確認 §3 的分岔決策。

---

## 1. 現況盤點（已經有的，不用重做）

| 能力 | 現況 | 檔案 |
|---|---|---|
| Bug 偵測 + 回報 | ✅ Slice 18：`reportBug()` → `bugReports/{id}` → 鈴鐺+email → 開 GitHub Issue | `lib/bugs/bugReporter.ts` |
| Bug 修復 agent | ✅ Slice 19：GitHub Actions `workflow_dispatch`(Issue 編號) → Claude Agent SDK 改 code → tsc/eslint/build → 開 PR（**無 merge 權限**） | `.github/workflows/bug-fix-agent.yml`、`scripts/bug-fix-agent.mjs` |
| 雙重 HITL | ✅ 關卡1=人工觸發 workflow、關卡2=人工 review PR 才 merge | 同上 |
| 資料分析型 agent | ✅ Sidekick / 診斷批次走 Tool Runner | `lib/ai/tools/` |

**缺口只有一個**：目前觸發修復 agent 要「開 GitHub Issue → 到 Actions 頁按按鈕」。使用者想改成**在手機聊天室打一句話就啟動**，並把「修 bug」擴大到「開發新功能」。

---

## 2. OpenAB 架構重點（我們借鑑什麼）

```
聊天平台 ──adapter──► OpenAB broker(Rust) ──ACP stdio JSON-RPC──► coding CLI(Claude Code…)
Discord/Slack 原生；Telegram/Teams/LINE/Feishu 走 Custom Gateway
```
- **thin broker**：平台訊息 → 統一 dispatcher + session pool → **每個 thread 一個 CLI process** → 跨一層 ACP 邊界到 agent。
- 特色：@mention 觸發、thread 多輪對話、edit-streaming（1.5s 更新訊息）、權限自動回覆、K8s-ready（PVC 存登入狀態）。
- **關鍵事實**：OpenAB 支援 **Claude Code 當後端**，且 **Telegram/Teams 官方就靠它的 Custom Gateway**。所以「互動式」路線不必自幹橋接，直接部署 OpenAB 指向 Claude Code 可能比自寫更省。

---

## 3. ⭐ 唯一要使用者決定的分岔：Dispatch vs Interactive

使用者講的三種 agent，對應到兩種操作模型：

| 使用者說的 | 本質 | 適合模型 |
|---|---|---|
| **bug agent**（修已知 bug） | 給任務→產出 PR | Dispatch ✅ |
| **coding agent**（開發新功能） | 給任務→產出 PR | Dispatch ✅ |
| **debug agent**（探索式除錯：「為什麼壞了，陪我翻」） | 來回互動、邊看邊問 | **Interactive**（唯一真的需要重路線的） |

### 路線 A — Dispatch（推薦先做）
```
聊天室打「/fix #28」或「/build 幫貼文卡片加分享按鈕」
  → bot 建立/貼標 GitHub Issue
  → 觸發 workflow_dispatch（沿用 Slice 19）
  → Agent SDK 改 code → 三關 → 開 PR
  → 進度/PR 連結串回聊天室
```
- **幾乎免費**：99% 沿用 Slice 19。「開發新功能」只是把修復 agent 從「只吃 bug issue」放寬到「吃任何 issue」。
- 保留完整雙重 HITL、agent 無 merge 權限。
- 缺點：一次性「發任務→拿 PR」，不能邊聊邊探索。

### 路線 B — Interactive（探索式除錯才需要，較重）
```
聊天室 @bot → 常駐主機上一個活著的 Claude Code session（已 checkout repo）
  → 邊聊邊查、跑指令、看 log → 覺得可以了再叫它開 PR
```
- 這就是 **OpenAB 的本體**。做法＝部署 OpenAB，後端接 Claude Code。
- 缺點：需要一台**持續開機、已登入 CLI、有 repo 檔案系統**的主機 → 營運較重、成本持續產生。

> **我的建議**：**先做路線 A（Dispatch）+ Telegram**。理由：沿用既有、成本 pay-per-run、Telegram 最好建（無需審核）。等真的常用探索式除錯，再加路線 B（部署 OpenAB）。

---

## 4. 主機在哪（承載式限制，最重要）

**Vercel 兩條路都不能跑**：serverless 無常駐 process、無持久檔案系統。

| 需求 | 路線 A | 路線 B |
|---|---|---|
| 收 Telegram/Discord 訊息的常駐 bot | 需要 | 需要 |
| 跑 coding agent | GitHub Actions（既有，免自管主機） | 常駐主機上的 Claude Code |
| 建議主機 | **Railway**（小服務收訊息、轉發 GitHub API；git-push 部署、always-on） | **Railway** 或小型 VM 跑 OpenAB 容器 |

- 路線 A 的 bot 很輕（收訊息→打 GitHub API→回訊息），Railway 一個小 service 就夠。
- 不建議給非工程師 k8s/Helm；Railway 是務實的託管選擇（我們有 Railway 工具可直接開）。

---

## 5. 🔒 安全（第一級議題，不是附註）

這是「**用聊天訊息觸發、在存有正式金鑰的 repo 上跑 code**」。attack surface 很實：

1. **身分白名單**：只有名單內的 chat user ID 能下指令；只認名單內 channel/chat。其他人一律忽略（連「存在與否」都不回）。
2. **秘密只在主機**：Anthropic/Meta/Firebase/GitHub token 存 Railway env 或 Actions secret，**絕不進聊天室、不回顯**。
3. **雙重 HITL 端到端保留**：bot 只能「觸發」與「回報」；**永遠不能 merge**。PR 一律人工在 GitHub review 後才合。
4. **權限路徑標記**：`GITHUB_BUG_TOKEN`／Agent SDK 的 repo 寫入權是最敏感一環——維持 agent 只改檔、branch/commit/PR 由 workflow 決定性執行、保護路徑（workflows、agent 腳本）被動到即拒。
5. **速率/濫用**：每人每日觸發次數上限，避免誤觸或惡意刷 Actions 分鐘數。

---

## 6. 平台難易度（不要三個平起平坐）

| 平台 | 難度 | 說明 | 建議 |
|---|---|---|---|
| **Telegram** | ★ 最易 | Bot API、long-poll、免公開網址、免審核 | **先做** |
| **Discord** | ★★ | OpenAB 原生；需 Bot intents 設定 | 次選（要 OpenAB 時） |
| **Teams** | ★★★★ 最重 | Azure Bot 註冊 + Graph + 組織管理員同意 | **延後** |

---

## 7. Vertical Slices（一次一片，三關全綠才 commit）

> **註（CI gate 精確定義）**：agent workflow 的 CI **只跑 `tsc` + `eslint`**；`next build`
> 由 Vercel preview 把關（第三道，但**不在 GitHub Actions gate 內**）→ PR 顯示綠燈**不代表
> build 過**，merge 前仍要確認 Vercel preview build 成功。人工開發流程的「三關」則是本機
> tsc + eslint + `next build` 全綠（見 CLAUDE.md 開發指令）。

- [x] **Slice 3C-1 — Telegram Dispatch bot（路線 A）**（`apps/ops-bot/`，commit 9614bfc；優雅關閉/退避 74f5ef4）
  - Railway 小 service：Telegram Bot（long-poll）→ 解析 `/fix <issue>`、`/build <描述>`、`/status`。
  - user ID 白名單、每日次數上限。
  - `/build`：呼叫 GitHub API 建 Issue（標 `agent-task`）→ 觸發 `workflow_dispatch` → 回 Issue/Run 連結。
  - `/fix #N`：直接對既有 Issue 觸發 workflow。
- [x] **Slice 3C-2 — 廣義化修復 agent 為「任務 agent」**（commit 63a131b；workflow `task_type: bug|feature`）
  - Slice 19 workflow 放寬：吃任何 `agent-task` label 的 issue（不限 bug）。system prompt 載入 CLAUDE.md（已有）。
  - PR 開好後 webhook / 輪詢 → 把 PR 連結推回 Telegram。
- [x] **Slice 3C-3 —（選配）狀態回饋**（`bug-fix-agent.yml` success/failure 兩步 curl Telegram）
  - workflow 各階段（開始／三關結果／PR 開立／失敗）用 Telegram 回報，取代人工盯 Actions 頁。
- [ ] **Slice 3C-4 —（選配，路線 B）部署 OpenAB 做探索式除錯**
  - Railway/VM 跑 OpenAB 容器，後端接 Claude Code（ACP），登入狀態存持久卷。
  - @mention 開 thread 互動除錯；產出仍走「開 PR → 人工 merge」。
- [ ] **Slice 3C-5 —（最後）Discord / Teams**
  - 有需要再加；Teams 最後。

---

## 7.5 三方案營運成本（每月估算）

> 假設：單一使用者、每月約 20–40 個 agent 任務、Telegram 前端。皆為粗估，實際依用量浮動。

成本三塊：**常駐主機** + **coding agent 算力** + **LLM token**。

| 項目 | A. Dispatch | B. Dispatch + Interactive | C. 只做 Interactive |
|---|---|---|---|
| 常駐主機（Railway） | 小 bot ~$5 | 小 bot $5 + OpenAB 常駐箱 $10–25 | OpenAB 常駐箱 $10–25 |
| coding 算力 | GitHub Actions（免費額度內 ~$0） | Actions ~$0 + 主機內跑 | 主機內跑（已含主機） |
| Anthropic token | 30 任務 × $0.5–1.5 ≈ $15–45 | 上列 + 互動 session ~$30 | 20 session × $2–3 ≈ $40–60 |
| **每月合計（估）** | **≈ $20–50** | **≈ $60–105** | **≈ $50–85** |

**最大的成本槓桿（決定性）＝ token 用 API 計費 vs 用 Claude 訂閱：**
- **Dispatch**（GitHub Actions + Agent SDK）**只能用 `ANTHROPIC_API_KEY`** → 按 token 計費，如上表。
- **Interactive**（OpenAB 跑 Claude Code CLI）**可用 Claude Pro/Max 訂閱登入**（device flow，如 OpenAB 的 `login --use-device-flow`）→ **token 邊際成本趨近 $0**，只付訂閱月費（Max 約 $100–200/mo，受方案額度限制）。
  - 意涵：**重度使用**時 Interactive 反而可能更划算（訂閱吃到飽 vs 每任務計費）；**輕度使用**時 Dispatch 最省（$20–50，且不用養常駐箱）。

**結論建議**：目前用量下 **A. Dispatch 最省（~$20–50/mo）**。若之後探索式除錯變高頻、或月 token 帳單逼近訂閱價，再切到 B/C 用訂閱吃到飽。

## 7.6 ✅ 定案：Dispatch + Telegram — 細部規格

> 使用者已確認（2026-07-21）：先做 **Dispatch**、平台 **Telegram**。以下為可執行規格。

### 接點盤點（現有，直接複用）
- Workflow：`.github/workflows/bug-fix-agent.yml` — `workflow_dispatch`、input `issue_number`、`concurrency: bug-fix-agent`（一次只跑一個）、guard 保護路徑、tsc+eslint、開 PR **無 merge**。
- Script：`scripts/bug-fix-agent.mjs` — Agent SDK，prompt 目前寫死「bug 修復工程師 / 最小 diff / 不加依賴」。
- Issue 慣例：`lib/bugs/bugReporter.ts`，REPO=`AliciaChen727/TM-contentloop`，label `['bug','ai-reported']`。
- **核心洞察**：Telegram bot 不用碰 agent，只要**呼叫 GitHub 的 workflow_dispatch API** 就能啟動整條既有 pipeline。

### Slice 3C-1 — Telegram Dispatch bot（Railway 常駐小服務）
- **形態**：Node 小服務，Telegram **long-poll（`getUpdates`）→ 免公開網址、免 webhook**。Railway 一個 service。
- **env**（只在 Railway，不進聊天室）：
  - `TELEGRAM_BOT_TOKEN`（找 @BotFather 建）
  - `TELEGRAM_ALLOWED_USER_IDS`（白名單，逗號分隔 numeric user id）
  - `GITHUB_DISPATCH_TOKEN`（fine-grained PAT：`actions:write` + `issues:write` + `contents:read`，只給這個 repo）
  - `GITHUB_REPO=AliciaChen727/TM-contentloop`
- **指令**：
  | 指令 | 動作 |
  |---|---|
  | `/fix <issue#>` | 對既有 issue 觸發 `bug-fix-agent.yml`（帶 `issue_number` + `telegram_chat_id`）→ 回 Run 連結 |
  | `/build <一句描述>` | 建 issue（label `agent-task`）→ 觸發 workflow（`task_type=feature`）→ 回 Issue+Run 連結 |
  | `/status` | 列最近幾筆 agent workflow run 狀態 + 未合併的 agent PR |
  | `/help` | 指令說明 |
- **安全**：非白名單 user id 一律**靜默忽略**（不回、不透露存在）；每人每日觸發上限（如 10 次）擋誤觸/濫用。
- **觸發 API**：`POST /repos/{repo}/actions/workflows/bug-fix-agent.yml/dispatches`，body `{ref:'main', inputs:{issue_number, task_type, telegram_chat_id}}`。

### Slice 3C-2 — 把「修復 agent」廣義化為「任務 agent」
- Workflow 加**選填 input**：`task_type`（`bug`|`feature`，預設 `bug`）、`telegram_chat_id`（選填）。
- `scripts/bug-fix-agent.mjs` 依 `task_type` 切 prompt：
  - `bug`（現況不動）：最小 diff、不加依賴、只修根因。
  - `feature`（新）：允許新增檔案/元件（遵守 CLAUDE.md：元件 ≤200 行、kebab/PascalCase、隔離鐵則、不隨意加重依賴），仍走三關、仍**無 merge**。
- **所有 guard／gate／無 merge／保護路徑規則原封不動**——雙重 HITL 完全保留（關卡1=Telegram 觸發、關卡2=你在 GitHub review PR 才合）。

### Slice 3C-3 — 結果回傳 Telegram（閉環）
- Workflow 尾端加兩步（`if: success()` / `if: failure()`）：用 `telegram_chat_id` **直接 curl Telegram sendMessage**回報「✅ 做好了，PR 👉 連結」或「❌ 失敗/agent 判斷不能安全修，原因見 log」。
- 好處：bot 不用一直輪詢 GitHub；狀態由 workflow 主動推回。需在 repo Actions secret 加 `TELEGRAM_BOT_TOKEN`（供 workflow 回話用）。

### 驗收（沿用專案紀律）
- 本機先跑 bot（`node`）用你的 Telegram 帳號實測 `/fix`、`/build`、白名單擋人、每日上限。
- 真的觸發一次 `/build` 小任務 → 確認 issue 開立、workflow 綠、PR 出現、Telegram 收到連結、**PR 仍需你手動 merge**。
- 你回 OK → 才 commit/push、Railway 部署 bot。

### 需要你準備的東西（部署前）
1. Telegram：跟 **@BotFather** 建一個 bot、拿 `TELEGRAM_BOT_TOKEN`；把你自己的 numeric user id 給我（跟 @userinfobot 對話會顯示）。
2. GitHub：建一個 fine-grained PAT（`actions:write`+`issues:write`+`contents:read`，範圍限本 repo）。
3. Railway：授權我用 Railway 工具開一個 service（或你自己開好給我 project）。
4. repo Actions secret：`ANTHROPIC_API_KEY`（已有）、新增 `TELEGRAM_BOT_TOKEN`。

## 8. 開放問題（待確認）

1. **§3 分岔**：先做 Dispatch（推薦）還是要一步到位含 Interactive？
2. 先上哪個平台：Telegram（推薦）／Discord？
3. 主機：Railway（推薦）可否？
4. 「開發新功能」指令的權限：是否任何白名單人都能觸發，還是只有 owner？
5. 成本上限：Actions 分鐘數 / Anthropic token 每月預算門檻。
