// Phase 5-2b：AI agent 回覆引擎（platform-agnostic）。輸入用戶訊息 + 粉專知識，
// 產出「回覆文字」或「轉真人」。發送交平台 adapter（Meta / 未來 LINE），此檔不發送。
// 日期事實（下次例會）走純程式（nextMeeting），不讓 LLM 算日期。
//
// grounding「全餵」：不用單一意圖 gate 答案——把 corrections + 排程 + 所有啟用答案 +
// 補充知識一起給 LLM，讓它自己挑相關資訊（抗分類雜訊）。都不相關才轉真人（[[HANDOFF]]）。
import Anthropic from '@anthropic-ai/sdk'
import { INTENTS, classifyMessages, type IntentKey } from '@/lib/messages/intents'
import { nextMeeting, type ParsedEntry } from '@/lib/messages/parseSchedule'

export interface Correction { text: string; fromMessage?: string; createdAt?: string; by?: string }
export interface AgentConfig {
  enabled: boolean
  humanHandoffEnabled: boolean
  fallbackMessage: string
  persona: string
  knowledgeBase: string
  answers: Partial<Record<IntentKey, { answer: string; enabled: boolean }>>
  scheduleEntries: ParsedEntry[]
  meetingTime: string
  meetingLocation: string
  replyModel?: 'standard' | 'advanced'
  corrections?: Correction[]
}

export interface AgentResult {
  action: 'reply' | 'handoff'
  text: string
  intent: IntentKey
  model?: string
  groundingUsed: string[]
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
function fmtNext(entry: ParsedEntry, time: string, location: string): string {
  const wd = WEEKDAYS[new Date(`${entry.date}T00:00:00+08:00`).getDay()]
  const parts = [`${entry.date}（週${wd}）`]
  if (time) parts.push(time)
  if (location) parts.push(`在 ${location}`)
  const base = parts.join(' ')
  return entry.label ? `${base}（${entry.label}）` : base
}

export async function generateReply(opts: {
  message: string
  config: AgentConfig
  todayIso: string
  anthropicKey: string | null
  geminiKey: string | null
}): Promise<AgentResult> {
  const { message, config, todayIso, anthropicKey, geminiKey } = opts

  // Classify intent — used for schedule injection + analytics only (NOT to gate answers).
  let intent: IntentKey = 'other'
  if (geminiKey) {
    try { intent = (await classifyMessages([message], geminiKey))[0] ?? 'other' } catch { /* keep 'other' */ }
  }

  // Assemble grounding — feed EVERYTHING relevant; LLM picks what answers the question.
  const grounding: string[] = []
  const groundingUsed: string[] = []

  const corr = (config.corrections ?? []).map(c => c.text?.trim()).filter(Boolean) as string[]
  if (corr.length) {
    grounding.push(`【重要更正／補充（優先參考）】\n${corr.map(c => `- ${c}`).join('\n')}`)
    groundingUsed.push('corrections')
  }
  if (intent === 'meeting_time' && config.scheduleEntries?.length) {
    const nx = nextMeeting(config.scheduleEntries, todayIso)
    if (nx) { grounding.push(`【下次例會】${fmtNext(nx, config.meetingTime, config.meetingLocation)}`); groundingUsed.push('schedule') }
  }
  if (config.meetingTime || config.meetingLocation) {
    grounding.push(`【例會時間／地點】${[config.meetingTime, config.meetingLocation].filter(Boolean).join('，')}`)
    groundingUsed.push('meetingInfo')
  }
  let anyAnswer = false
  for (const it of INTENTS) {
    const a = config.answers?.[it.key]
    if (a?.enabled && a.answer.trim()) { grounding.push(`【${it.zh}】${a.answer.trim()}`); anyAnswer = true }
  }
  if (anyAnswer) groundingUsed.push('answers')
  if (config.knowledgeBase.trim()) { grounding.push(`【補充知識】\n${config.knowledgeBase.trim()}`); groundingUsed.push('knowledge') }

  // Nothing to ground on → hand off.
  if (grounding.length === 0) return { action: 'handoff', text: config.fallbackMessage, intent, groundingUsed }

  // No LLM key → can't synthesize; hand off.
  if (!anthropicKey) return { action: 'handoff', text: config.fallbackMessage, intent, groundingUsed }

  const model = config.replyModel === 'advanced' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'
  const system = `你是 Facebook / Instagram 粉專的客服小編。語氣：${config.persona || '親切、簡潔、有禮貌'}。
規則：
- 只依「可用資訊」回答；絕不編造未提供的時間、地點、費用或承諾。
- 用繁體中文、口語、簡短（2–4 句）。
- 「可用資訊」裡任何一段只要能回答用戶問題就用它作答，不要因為分類標籤而忽略相關內容。
- 若「可用資訊」完全無法回答用戶的問題，請「只輸出」：[[HANDOFF]]（不要其他任何字）。
- 不要出現「根據資料」「as an AI」「作為 AI」這類字眼。`
  const userContent = `用戶訊息：「${message}」

可用資訊：
${grounding.join('\n\n')}

請據此自然地回覆用戶（若都不相關則只輸出 [[HANDOFF]]）。`
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const res = await anthropic.messages.create({ model, max_tokens: 400, system, messages: [{ role: 'user', content: userContent }] })
    const text = res.content[0]?.type === 'text' ? res.content[0].text.trim() : ''
    if (!text || text.includes('[[HANDOFF]]')) return { action: 'handoff', text: config.fallbackMessage, intent, model, groundingUsed }
    return { action: 'reply', text, intent, model, groundingUsed }
  } catch {
    return { action: 'handoff', text: config.fallbackMessage, intent, groundingUsed }
  }
}
