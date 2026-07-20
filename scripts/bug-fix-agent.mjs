// Phase 3B Slice 19 — bug-fix agent (runs INSIDE GitHub Actions only).
// Claude Agent SDK edits the working tree to fix one GitHub issue; this script
// never touches git — the workflow makes the branch/commit/PR deterministically,
// and merging is always a human decision. Double HITL:
//   關卡1: a human triggers the workflow_dispatch
//   關卡2: a human reviews + merges the PR (the agent has no merge rights)
import fs from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const issueFile = process.env.ISSUE_FILE
const summaryFile = process.env.SUMMARY_FILE ?? '/tmp/agent-summary.md'
if (!issueFile || !fs.existsSync(issueFile)) {
  console.error('ISSUE_FILE missing')
  process.exit(1)
}
const issue = JSON.parse(fs.readFileSync(issueFile, 'utf8'))
const taskType = process.env.TASK_TYPE === 'feature' ? 'feature' : 'bug' // default bug

// Shared rules for both modes (safety guards live in the workflow too).
const commonRules = [
  '- 絕對不可修改 .github/workflows/、scripts/bug-fix-agent.mjs、或任何 secret/env 檔。',
  '- 絕對不可執行任何 git 指令（branch/commit/push 由外層 workflow 處理）。',
  '- 程式碼在 apps/web/（Next.js 14 + TypeScript）。遵守專案 CLAUDE.md 的隔離鐵則與慣例。',
  '- 完成後必須在 apps/web/ 裡執行 `npx tsc --noEmit` 驗證型別通過；有錯就修到過。',
]

const bugPrompt = [
  `你是 ContentLoop 的 bug 修復工程師。請修復下面這個 GitHub Issue 描述的 bug。`,
  '',
  `## Issue #${issue.number}: ${issue.title}`,
  '',
  issue.body ?? '(no body)',
  '',
  '## 硬性規則（違反任何一條 = 失敗）',
  '- 只修這個 bug 的根因，最小 diff；不要順手重構、不要加新依賴、不要改無關檔案。',
  ...commonRules,
  '- 如果你判斷這個 issue 無法安全地自動修復（資訊不足、需要產品決策、或風險太高），不要亂改：不要動任何檔案，並在總結中說明原因。',
  '',
  '## 最後輸出',
  '完成後，用繁體中文總結：root cause、改了哪些檔案與為什麼、你怎麼驗證的、reviewer 需要注意什麼。',
].join('\n')

const featurePrompt = [
  `你是 ContentLoop 的功能開發工程師。請依下面這個 GitHub Issue 開發新功能。`,
  '',
  `## Issue #${issue.number}: ${issue.title}`,
  '',
  issue.body ?? '(no body)',
  '',
  '## 硬性規則（違反任何一條 = 失敗）',
  '- 聚焦這個需求，做最小可用的完整 vertical slice；可新增檔案/元件，但不要順手改無關功能。',
  '- 遵守 CLAUDE.md 慣例：元件 ≤200 行、資料夾 kebab-case、元件 PascalCase、每檔職責單一。',
  '- 不隨意加新依賴；真的必要才加，並在總結說明理由。',
  '- 涉及讀取貼文/廣告/洞察資料時，嚴守多粉專 pageId 隔離鐵則（見 CLAUDE.md）。',
  ...commonRules,
  '- 如果需求太模糊、需要產品決策、或無法安全實作，不要亂做：不要動任何檔案，並在總結中說明原因與你需要的澄清。',
  '',
  '## 最後輸出',
  '完成後，用繁體中文總結：做了什麼、改/新增了哪些檔案與為什麼、你怎麼驗證的、reviewer 需要注意什麼、有哪些尚未涵蓋的部分。',
].join('\n')

const prompt = taskType === 'feature' ? featurePrompt : bugPrompt
console.log(`[task] type=${taskType} issue=#${issue.number}`)

let resultText = ''
let success = false
try {
  const q = query({
    prompt,
    options: {
      cwd: process.cwd(),                 // repo root (workflow checks this out)
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions', // sandboxed CI runner; guards are in the workflow
      settingSources: ['project'],         // load CLAUDE.md rules
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
      maxTurns: 80,
    },
  })
  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) console.log('[agent]', block.text.slice(0, 400))
      }
    }
    if (msg.type === 'result') {
      success = msg.subtype === 'success'
      resultText = ('result' in msg ? msg.result : '') || ''
      console.log(`[done] subtype=${msg.subtype} turns=${msg.num_turns ?? '?'} cost=$${msg.total_cost_usd?.toFixed?.(3) ?? '?'}`)
    }
  }
} catch (e) {
  console.error('agent run failed:', e instanceof Error ? e.message : e)
  process.exit(1)
}

fs.writeFileSync(summaryFile, [
  `## 🤖 AI 修復摘要（Issue #${issue.number}）`,
  '',
  resultText || '(agent 未提供總結)',
  '',
  '---',
  `Closes #${issue.number}`,
  '',
  '> ⚠️ 此 PR 由 AI 修復 agent 產生（Phase 3B Slice 19）。**merge 前請人工 review**；',
  '> Vercel 會對本 PR 自動跑 preview build（第三道驗證）。CI 已通過 tsc + eslint。',
].join('\n'))

if (!success) {
  console.error('agent did not finish successfully')
  process.exit(1)
}
