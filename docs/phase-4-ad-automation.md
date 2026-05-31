# Phase 4 — 半自動 / 自動化廣告更新 (Semi-Automated Ad Update)

> **階段定位**（roadmap 統一為 Phase 2 / 3 / 4）：
> - **Phase 2**：站內通知中心（`phase-2-notification-center.md`）。
> - **Phase 3**：AI Sidekick 優化 loop — 通知帶優化建議 + 可複製 prompt，人類按一下生成新素材方向。
> - **Phase 4（本文件）**：把 Sidekick 的產出**寫回廣告帳號**，朝「一鍵套用」逼近。
>
> ⚠️ **風險級別比 Phase 2/3 高一階**：Phase 2/3 壞掉頂多通知不準、建議不好；Phase 4 壞掉是
> **真的動到別人花錢投放的廣告**。因此採嚴格 **human-in-the-loop**，且獨立評估、獨立排期。

```
Phase 3 產出（新文案/素材方向）→ Phase 4：存草稿 → 人工審核 → 寫入 Meta → 監控成效
                                          ↑ 強制關卡，絕不無人值守上線
```

---

## 1. 目標與範圍 (Scope)

### In scope
1. **草稿化**：Sidekick 產出的新文案 / 素材方向 → 一鍵存成「優化草稿」（Firestore），可在站內檢視/編輯。
2. **人工審核關卡**：草稿需 Admin 明確「核准」才會進入寫入流程，預設絕不自動套用。
3. **寫入 Meta**（半自動）：核准後透過 Meta Marketing API 建立**新廣告變體 / A/B**（優先）或更新既有素材。
4. **回寫狀態 + 監控**：寫入結果（成功/失敗/pending review）回寫站內通知；後續成效納入既有 insights 追蹤。

### Out of scope（明確不做）
- ❌ 全自動無人值守上線（永遠要人核准）。
- ❌ 自動調整預算 / 出價（只動素材，不動花費策略 — 風險與合規另議）。
- ❌ 自動暫停 / 刪除既有廣告（破壞性操作不自動化）。
- ❌ 跨帳號批次套用（先單粉專、單廣告驗證）。

---

## 2. 與 Phase 3 的銜接點

| 來源（Phase 3） | Phase 4 接手 |
|------------------|--------------|
| Sidekick 產出的新文案 / 圖像方向 | 存成 `optimizationDraft`（含原廣告 ref、目標、產出內容、生成 prompt） |
| `actionPrompt` 的 context（廣告名、目標、現況數據） | 帶進草稿，供審核時對照 |

Phase 4 不重新生成內容；它只負責「**把已生成、且人類認可的內容，安全地送進 Meta**」。

---

## 3. 資料模型（初稿）

```
pages/{pageId}/optimizationDrafts/{draftId}
  sourceNotifId:  string          // 來自哪則 Phase 2/3 通知
  adRef:          { adId, adsetId, campaignId, storyId }
  goal:           string          // optimizationGoal（沿用 settings）
  original:       { headline, body, mediaUrl }   // 變更前
  proposed:       { headline, body, mediaUrl }   // Sidekick 產出
  generatedPrompt: string         // 可追溯：當初送進 Sidekick 的 prompt
  status:         'draft' | 'approved' | 'applying' | 'applied' | 'failed' | 'rejected'
  approvedByUid:  string | null
  metaResult:     { newAdId?, error? } | null
  createdAt / updatedAt
```

---

## 4. Meta API 前置（關鍵阻塞項）

這是 Phase 4 能不能做的**決定性前提**，需先確認：

1. **權限升級**：目前 `lib/meta/` 只用**讀取**權限（insights）。寫入廣告需要 `ads_management`（寫入級），遠比讀取嚴格。
2. **App Review**：`ads_management` 屬進階權限，須通過 Meta App Review（提供使用情境、demo 影片、隱私政策）。準備期以週計。
3. **商業驗證 (Business Verification)**：寫入級權限通常要求 App 綁定已驗證的 Business。
4. **權杖 scope**：現有使用者授權流程要加上寫入 scope，並重新授權既有粉專。
5. **沙盒測試**：先在 Meta 測試廣告帳號 / 測試素材驗證寫入流程，不可直接動正式投放。

> 在 1–4 釐清之前，Phase 4 只能停在「**草稿 + 審核 UI**」（不碰 Meta 寫入），這部分可先做。

---

## 5. 分步交付 (Milestones)

| 里程碑 | 內容 | 需要 Meta 寫入權限？ |
|--------|------|----------------------|
| **4a 草稿 + 審核 UI** | Sidekick 產出存草稿、站內檢視/編輯/核准/拒絕、狀態流轉 | ❌ 不需要，可先做 |
| **4b 沙盒寫入** | 在 Meta 測試帳號上，核准的草稿建立新變體 | ✅ 需先過 App Review |
| **4c 正式半自動** | 正式帳號、建立 A/B 新變體、結果回寫通知 + 成效監控 | ✅ |

**建議**：先做 4a（純前端 + Firestore，零 Meta 風險），同時並行跑 Meta App Review 的申請；審核過了再推 4b/4c。

---

## 6. 風險與控管
- **動到真實投放**：強制人工核准；破壞性操作（暫停/刪除/改預算）一律不自動化。
- **品牌 / 合規**：審核 UI 要清楚 diff（原文 vs 新文），讓 Admin 看得到差異再核准。
- **Meta 政策**：自動化廣告操作須符合 Meta Platform Policy，違規可能停權 — App Review 階段要講清楚使用情境。
- **可回溯**：每筆寫入保留 `generatedPrompt` 與 original，出問題能追到來源與還原。
- **失敗處理**：寫入失敗回寫 `failed` + error，通知 Admin，不靜默吞錯。

---

## 7. 驗收標準（4a 先行版）
- [ ] Sidekick 產出可一鍵存成草稿，狀態 `draft`。
- [ ] 草稿頁顯示原文 vs 新文 diff、來源通知、生成 prompt。
- [ ] Admin 可核准 / 拒絕；核准後狀態 `approved`（4a 階段尚不寫 Meta）。
- [ ] 非該粉專 Admin 看不到草稿。

> 4b/4c 的驗收標準待 Meta App Review 結果確定後補上。

---

## 8. 開放問題（待決策）
- Meta `ads_management` App Review 是否值得投入？（先評估申請成本 vs 預期使用率）
- 寫入策略：**建新變體（A/B，較安全）** vs **更新既有素材（較直接但動到 live ad）** — 預設建議前者。
- 是否需要「自動套用」的進階開關（資深 Admin 專用）？預設**不提供**，避免誤觸。
