// Phase 3C — thin Telegram Bot API client (long-poll, zero deps).
import { config } from './config.mjs'

const API = `https://api.telegram.org/bot${config.telegramToken}`

export async function getMe() {
  const res = await fetch(`${API}/getMe`)
  const json = await res.json()
  if (!json.ok) throw new Error(`getMe failed: ${JSON.stringify(json)}`)
  return json.result
}

// Long-poll for updates. `offset` = last processed update_id + 1.
export async function getUpdates(offset, timeoutSec = 30) {
  const url = `${API}/getUpdates?timeout=${timeoutSec}` +
    `&allowed_updates=${encodeURIComponent('["message"]')}` +
    (offset ? `&offset=${offset}` : '')
  const res = await fetch(url, { signal: AbortSignal.timeout((timeoutSec + 10) * 1000) })
  const json = await res.json()
  if (!json.ok) throw new Error(`getUpdates failed: ${JSON.stringify(json)}`)
  return json.result
}

export async function sendMessage(chatId, text) {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  const json = await res.json()
  if (!json.ok) console.error('[telegram] sendMessage failed:', JSON.stringify(json))
  return json.ok
}
