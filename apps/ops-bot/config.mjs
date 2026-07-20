// Phase 3C — ops-bot config. All secrets come from env (Railway), never hardcoded.
function required(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`[config] missing required env: ${name}`)
    process.exit(1)
  }
  return v.trim()
}

// Whitelisted Telegram numeric user ids — only these may command the bot.
const allowed = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (allowed.length === 0) {
  console.error('[config] TELEGRAM_ALLOWED_USER_IDS is empty — refusing to start (bot would accept nobody or, worse, be misconfigured open).')
  process.exit(1)
}

export const config = {
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  allowedUserIds: new Set(allowed),
  githubToken: required('GITHUB_DISPATCH_TOKEN'),
  repo: process.env.GITHUB_REPO?.trim() || 'AliciaChen727/TM-contentloop',
  workflowFile: process.env.WORKFLOW_FILE?.trim() || 'bug-fix-agent.yml',
  defaultBranch: process.env.DEFAULT_BRANCH?.trim() || 'main',
  dailyLimit: Number(process.env.DAILY_LIMIT ?? '10'),
}
