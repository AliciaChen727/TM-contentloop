# ContentLoop Ops Bot (Phase 3C)

Telegram ChatOps bot. Bridges Telegram → GitHub `workflow_dispatch` → the existing
Slice 19 coding/bug-fix agent. **Runs on Railway (always-on), not Vercel** (Vercel
serverless can't host a long-poll process).

## What it does

| Command | Action |
|---|---|
| `/fix <issue#>` | Dispatch the agent to fix an existing GitHub Issue (`task_type=bug`) |
| `/build <描述>` | Create an `agent-task` Issue, then dispatch the agent (`task_type=feature`) |
| `/status` | Show recent agent runs + open agent PRs waiting for your review |
| `/help` | Usage |

## Security

- Only user ids in `TELEGRAM_ALLOWED_USER_IDS` are obeyed; everyone else is silently ignored.
- Secrets live only in env (Railway) — never in chat, never committed.
- The bot **cannot merge**. It only triggers and reports. Double HITL is preserved:
  關卡1 = you send the command; 關卡2 = you review + merge the PR on github.com.
- Per-user daily trigger cap (`DAILY_LIMIT`, default 10) on the expensive commands.

## Local test

```bash
cd apps/ops-bot
cp .env.example .env.local
# fill TELEGRAM_BOT_TOKEN + GITHUB_DISPATCH_TOKEN in .env.local
node --env-file=.env.local index.mjs
```

Then message your bot on Telegram: `/help`, `/status`, `/fix <issue#>`.

## Deploy (Railway)

Point a Railway service at this directory (`apps/ops-bot`), set the same env vars
as service variables, start command `npm start`. Long-poll needs no public URL.

## Requires (in the GitHub repo)

- Actions secret `ANTHROPIC_API_KEY` (already set for Slice 19).
- Actions secret `TELEGRAM_BOT_TOKEN` (so the workflow can send the result back to chat).
- Workflow `.github/workflows/bug-fix-agent.yml` accepts inputs `issue_number`,
  `task_type`, `telegram_chat_id` (added in Slice 3C-2/3C-3).
