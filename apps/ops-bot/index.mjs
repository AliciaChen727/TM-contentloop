// Phase 3C Slice 3C-1 — Telegram ChatOps bot.
// Bridges Telegram -> GitHub workflow_dispatch -> existing Slice 19 coding agent.
// Security model: only whitelisted user ids are obeyed; everyone else is
// silently ignored. The bot can trigger and report, but NEVER merges.
import { config } from './config.mjs'
import { getMe, getUpdates, sendMessage } from './telegram.mjs'
import { createIssue, dispatchWorkflow, recentRuns, openAgentPRs, actionsPageUrl } from './github.mjs'

const START_TIME = Math.floor(Date.now() / 1000) // ignore messages queued before boot
const rate = new Map() // userId -> { day: 'YYYY-MM-DD', count }

const HELP = [
  '<b>ContentLoop Ops Bot</b>',
  '把指令交給你的開發 agent（它只會開 PR，永遠不會自己合併）。',
  '',
  '<b>/fix &lt;issue編號&gt;</b> — 讓 agent 修某個 GitHub Issue',
  '   例：<code>/fix 28</code>',
  '<b>/build &lt;想要的功能&gt;</b> — 開一張任務單並讓 agent 開發',
  '   例：<code>/build 幫貼文卡片加分享按鈕</code>',
  '<b>/status</b> — 看最近的 agent 執行狀態與待合併的 PR',
  '<b>/help</b> — 顯示這則說明',
  '',
  '做好後我會把 PR 連結傳回這裡，你到 GitHub review 後再自己 merge。',
].join('\n')

function allowed(userId) {
  return config.allowedUserIds.has(String(userId))
}

// /build is owner-only (feature dev = the agent writes new code). /fix stays open
// to the whole allowlist. See config.buildOwnerIds.
function isBuildOwner(userId) {
  return config.buildOwnerIds.has(String(userId))
}

// Rate-limit only the expensive commands (agent runs cost money + open PRs).
function overLimit(userId) {
  const day = new Date().toISOString().slice(0, 10)
  const cur = rate.get(userId)
  if (!cur || cur.day !== day) {
    rate.set(userId, { day, count: 1 })
    return false
  }
  if (cur.count >= config.dailyLimit) return true
  cur.count += 1
  return false
}

async function handleFix(chatId, userId, arg) {
  const n = parseInt(String(arg).replace('#', '').trim(), 10)
  if (!Number.isInteger(n) || n <= 0) {
    return sendMessage(chatId, '用法：<code>/fix 28</code>（填 GitHub Issue 編號）')
  }
  if (overLimit(userId)) return sendMessage(chatId, `今天觸發次數已達上限（${config.dailyLimit} 次），明天再試。`)
  try {
    await dispatchWorkflow({ issueNumber: n, taskType: 'bug', chatId })
    await sendMessage(chatId, `🛠️ 已交給 agent 修 Issue #${n}。做好會傳 PR 連結回來。\n進度：<a href="${actionsPageUrl()}">Actions</a>`)
  } catch (e) {
    await sendMessage(chatId, `❌ 觸發失敗：${e.message}`)
  }
}

async function handleBuild(chatId, userId, desc) {
  if (!isBuildOwner(userId)) {
    return sendMessage(chatId, '⛔ <b>/build</b> 僅限擁有者使用（開發新功能權限較高）。你可以用 <b>/fix &lt;issue編號&gt;</b> 修既有 Issue。')
  }
  const text = String(desc).trim()
  if (text.length < 5) {
    return sendMessage(chatId, '用法：<code>/build 幫貼文卡片加分享按鈕</code>（描述清楚一點）')
  }
  if (overLimit(userId)) return sendMessage(chatId, `今天觸發次數已達上限（${config.dailyLimit} 次），明天再試。`)
  try {
    const title = text.length > 60 ? text.slice(0, 57) + '…' : text
    const issue = await createIssue({
      title,
      body: [`（由 Telegram ops-bot 建立的開發任務）`, '', '## 需求', text].join('\n'),
      labels: ['agent-task', 'feature'],
    })
    await dispatchWorkflow({ issueNumber: issue.number, taskType: 'feature', chatId })
    await sendMessage(chatId, `📝 已開任務單 <a href="${issue.url}">#${issue.number}</a> 並交給 agent 開發。做好會傳 PR 連結回來。`)
  } catch (e) {
    await sendMessage(chatId, `❌ 建立/觸發失敗：${e.message}`)
  }
}

async function handleStatus(chatId) {
  // Degrade gracefully: one failing call must not blank the whole reply.
  const [runsRes, prsRes] = await Promise.allSettled([recentRuns(5), openAgentPRs()])
  const lines = ['<b>最近 agent 執行</b>']
  if (runsRes.status === 'fulfilled') {
    if (runsRes.value.length === 0) lines.push('（尚無紀錄）')
    for (const r of runsRes.value) {
      const emoji = r.status !== 'completed' ? '⏳' : r.conclusion === 'success' ? '✅' : r.conclusion === 'cancelled' ? '⏹️' : '❌'
      const stateZh = r.status !== 'completed'
        ? (r.status === 'queued' ? '排隊中' : '執行中')
        : r.conclusion === 'success' ? '成功' : r.conclusion === 'cancelled' ? '已取消（被更新的執行取代）' : '失敗'
      const time = new Date(r.created).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' })
      lines.push(`${emoji} <a href="${r.url}">${r.title ?? 'run'}</a> — ${stateZh}（${time}）`)
    }
  } else {
    lines.push(`（查詢失敗：${runsRes.reason?.message ?? runsRes.reason}）`)
  }
  lines.push('', '<b>待你 review / merge 的 PR</b>')
  if (prsRes.status === 'fulfilled') {
    if (prsRes.value.length === 0) lines.push('（沒有）')
    for (const p of prsRes.value) lines.push(`• <a href="${p.url}">#${p.number}</a> ${p.title}`)
  } else {
    lines.push(`（查詢失敗：${prsRes.reason?.message ?? prsRes.reason}）`)
  }
  await sendMessage(chatId, lines.join('\n'))
}

async function handle(msg) {
  const userId = msg.from?.id
  const chatId = msg.chat?.id
  const text = (msg.text ?? '').trim()
  if (!userId || !chatId || !text) return
  if (msg.date && msg.date < START_TIME) return // skip stale backlog after restart
  if (!allowed(userId)) {
    console.log(`[ignore] non-whitelisted user ${userId}`)
    return // silent — do not reveal the bot exists
  }

  const [cmdRaw, ...rest] = text.split(/\s+/)
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '') // strip @botname in groups
  const arg = text.slice(cmdRaw.length).trim()

  switch (cmd) {
    case '/start':
    case '/help':
      return sendMessage(chatId, HELP)
    case '/fix':
      return handleFix(chatId, userId, arg)
    case '/build':
      return handleBuild(chatId, userId, arg)
    case '/status':
      return handleStatus(chatId)
    default:
      return sendMessage(chatId, '不認得這個指令。打 /help 看可用指令。')
  }
}

let shuttingDown = false

// Exit promptly on redeploy so we never leave a zombie long-poll holding the
// Telegram slot (that causes a permanent 409 ping-pong with the new instance).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[ops-bot] received ${sig}, shutting down`)
    shuttingDown = true
    process.exit(0)
  })
}

async function main() {
  const me = await getMe()
  console.log(`[ops-bot] up as @${me.username}; whitelist=${[...config.allowedUserIds].join(',')}; repo=${config.repo}`)
  let offset = 0
  while (!shuttingDown) {
    try {
      const updates = await getUpdates(offset, 30)
      for (const u of updates) {
        offset = u.update_id + 1
        if (u.message) await handle(u.message)
      }
    } catch (e) {
      // 409 = another instance is polling the same bot (usually an old deploy
      // still draining). Back off longer so the two converge quickly once the
      // stale one exits, instead of hammering every 3s.
      const is409 = String(e.message).includes('409')
      console.error('[loop] error:', e.message)
      await new Promise((r) => setTimeout(r, is409 ? 8000 : 3000))
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', e)
  process.exit(1)
})
