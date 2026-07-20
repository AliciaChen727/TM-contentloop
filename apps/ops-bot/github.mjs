// Phase 3C — thin GitHub REST client (zero deps). The bot only ever:
//   1. creates an issue (for /build)
//   2. dispatches the existing bug-fix-agent workflow
//   3. reads recent runs / open agent PRs (for /status)
// It CANNOT merge — merging stays a human decision on github.com (關卡2).
import { config } from './config.mjs'

const BASE = `https://api.github.com/repos/${config.repo}`

function headers() {
  return {
    authorization: `Bearer ${config.githubToken}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'contentloop-ops-bot',
  }
}

export async function createIssue({ title, body, labels }) {
  const res = await fetch(`${BASE}/issues`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ title, body, labels }),
  })
  if (!res.ok) throw new Error(`createIssue ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return { number: json.number, url: json.html_url }
}

// Trigger workflow_dispatch. Returns nothing useful (GitHub replies 204),
// so callers link the user to the Actions page instead.
export async function dispatchWorkflow({ issueNumber, taskType, chatId }) {
  const res = await fetch(`${BASE}/actions/workflows/${config.workflowFile}/dispatches`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      ref: config.defaultBranch,
      inputs: {
        issue_number: String(issueNumber),
        task_type: taskType,
        telegram_chat_id: String(chatId),
      },
    }),
  })
  if (res.status !== 204) throw new Error(`dispatch ${res.status}: ${await res.text()}`)
}

export async function recentRuns(limit = 5) {
  const res = await fetch(
    `${BASE}/actions/workflows/${config.workflowFile}/runs?per_page=${limit}`,
    { headers: headers() },
  )
  if (!res.ok) throw new Error(`runs ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return (json.workflow_runs ?? []).map((r) => ({
    id: r.id,
    title: r.display_title, // e.g. "🤖 開發 Issue #41" (from workflow run-name)
    status: r.status, // queued | in_progress | completed
    conclusion: r.conclusion, // success | failure | cancelled | null
    url: r.html_url,
    created: r.created_at,
  }))
}

export async function openAgentPRs() {
  const res = await fetch(`${BASE}/pulls?state=open&per_page=20`, { headers: headers() })
  if (!res.ok) throw new Error(`pulls ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json
    .filter((p) => (p.head?.ref ?? '').startsWith('ai-'))
    .map((p) => ({ number: p.number, title: p.title, url: p.html_url }))
}

export function actionsPageUrl() {
  return `https://github.com/${config.repo}/actions/workflows/${config.workflowFile}`
}
