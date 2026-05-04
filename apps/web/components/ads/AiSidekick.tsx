'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from './Icon'

interface AiResponse {
  type: string
  summary: string
  bullets: string[]
  stats: { label: string; value: string }[]
  actions: string[]
}

const AI_RESPONSES: Record<string, AiResponse> = {
  roas_drop: { type:'analysis', summary:'本週 ROAS 下滑主因有三點：', bullets:['「女性25-34 興趣電商」頻率達 4.8，受眾疲乏導致 CPM 上升 22%','週末 ROAS 歷史偏低，本週末花費佔比過高','「夏日特賣 Reels」素材已投放 18 天，新鮮感下降'], stats:[{label:'ROAS',value:'3.82x'},{label:'上週',value:'4.21x'},{label:'降幅',value:'-9.3%'}], actions:['暫停「女性25-34 興趣電商」或換新素材','週末降低預算 15%，週五加碼','安排 2–3 組新 Reels 素材入庫'] },
  budget_alloc: { type:'recommendation', summary:'根據各組合 ROAS 表現，建議以下調整：', bullets:['「類似受眾-購買名單 2%」ROAS 5.2，建議增加 30%','「再行銷-瀏覽未購買」ROAS 僅 1.9，建議削減 50% 預算','「男性35+ 興趣健身」CTR 偏低，建議換文案再觀察 7 天'], stats:[{label:'預計 ROAS',value:'4.18x'},{label:'節省預算',value:'$21K'}], actions:['「類似受眾 2%」增加 $24,000','「再行銷」削減 $21,300','「健身」暫停，換文案後重開'] },
  audience_fatigue: { type:'warning', summary:'帳戶中有 2 個組合出現受眾疲乏跡象：', bullets:['「女性25-34 興趣電商」頻率 4.8（門檻 3.5）','CTR 從上週 2.8% 下滑至本週 1.6%','CPM 上升 18%，表示受眾對廣告免疫'], stats:[{label:'受影響組合',value:'2 組'},{label:'最高頻率',value:'4.8x'}], actions:['立即更換素材（建議 3 組新創意）','擴大受眾至 1% 類似受眾','考慮暫停 3–5 天讓受眾休息'] },
  checklist: { type:'actions', summary:'本週建議操作清單（依優先順序）：', bullets:[], stats:[], actions:['🚨 暫停「再行銷-瀏覽未購買」，預算移轉至類似受眾','⚠️ 更換「女性25-34 興趣電商」素材','💰 「類似受眾-購買名單 2%」增加 $24,000 預算','📊 設定 19:00–21:00 分時加價 +20%','🎬 準備 2 支新 Reels 素材入庫測試'] },
  best_creative: { type:'analysis', summary:'素材表現排行前三名：', bullets:['🥇 夏日特賣 Reels 15s — ROAS 5.1，CTR 3.2%','🥈 新品上市輪播圖 — ROAS 4.2，花費效益佳','🥉 品牌故事 Reels 30s — ROAS 4.0，互動率高'], stats:[{label:'最高 ROAS',value:'5.1x'},{label:'最低 CPA',value:'$185'}], actions:['增加「夏日特賣 Reels」預算 20%','以「新品上市輪播」為範本製作新素材','「用戶見證貼文」（ROAS 2.4）暫停'] },
  default: { type:'general', summary:'根據您的帳戶數據，以下是我的分析：', bullets:['目前帳戶整體 ROAS 3.82x，高於目標 3.5x，表現良好','建議重點關注受眾疲乏與素材更新週期','本月預算使用率 82%，進度正常'], stats:[{label:'ROAS',value:'3.82x'},{label:'花費',value:'$287K'}], actions:['每週檢視頻率，超過 3.5 立即換素材','維持至少 3–5 組素材輪播測試','每月初重新評估受眾策略'] },
}

function getAIResponse(text: string): AiResponse {
  const t = text.toLowerCase()
  if (t.includes('roas') && (t.includes('下降') || t.includes('下滑') || t.includes('為什麼'))) return AI_RESPONSES.roas_drop
  if (t.includes('預算') && (t.includes('分配') || t.includes('划算') || t.includes('增加'))) return AI_RESPONSES.budget_alloc
  if (t.includes('受眾') || t.includes('疲乏') || t.includes('頻率')) return AI_RESPONSES.audience_fatigue
  if (t.includes('清單') || t.includes('本週') || t.includes('操作')) return AI_RESPONSES.checklist
  if (t.includes('素材') && (t.includes('最好') || t.includes('最佳') || t.includes('哪支'))) return AI_RESPONSES.best_creative
  return AI_RESPONSES.default
}

const HISTORY = [
  { id:'h1', title:'ROAS 下滑原因分析', date:'今天', time:'09:14' },
  { id:'h2', title:'本週預算分配建議', date:'今天', time:'08:32' },
  { id:'h3', title:'受眾疲乏警告處理', date:'昨天', time:'17:05' },
  { id:'h4', title:'素材表現比較', date:'昨天', time:'14:22' },
]

const SUGGESTIONS = ['這週 ROAS 為什麼下降？','哪個廣告組合應該增加預算？','我的受眾是否疲乏了？','建議我本週的操作清單']

interface Message {
  id: string
  role: 'ai' | 'user'
  text: string
  time: string
  response?: AiResponse | null
}

function AiMessageBody({ r }: { r: AiResponse }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      {r.summary && <p style={{ marginBottom: r.bullets.length ? 8 : 0 }}>{r.summary}</p>}
      {r.bullets.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {r.bullets.map((b, i) => <li key={i} style={{ display: 'flex', gap: 6 }}><span style={{ color: 'var(--ad-blue)' }}>▸</span><span>{b}</span></li>)}
        </ul>
      )}
      {r.stats.length > 0 && (
        <div className="ads-sk-stat-row">
          {r.stats.map((s, i) => <div key={i} className="ads-sk-stat"><div className="ads-sk-stat-label">{s.label}</div><div className="ads-sk-stat-value">{s.value}</div></div>)}
        </div>
      )}
      {r.actions.length > 0 && (
        <div className="ads-sk-action-list">
          {r.actions.map((a, i) => (
            <div key={i} className={`ads-sk-action-item ${checked[i] ? 'done' : ''}`} onClick={() => setChecked(p => ({ ...p, [i]: !p[i] }))}>
              <div className="ads-sk-action-cb">{checked[i] && <span style={{ fontSize: 10 }}>✓</span>}</div>
              <div className="ads-sk-action-text">{a}</div>
            </div>
          ))}
        </div>
      )}
      <div className="ads-sk-feedback">
        <button className={`ads-sk-fb-btn ${feedback === 'up' ? 'liked' : ''}`} onClick={() => setFeedback(feedback === 'up' ? null : 'up')}>
          <Icon name="thumb_up" size={12} /> 有幫助
        </button>
        <button className={`ads-sk-fb-btn ${feedback === 'down' ? 'disliked' : ''}`} onClick={() => setFeedback(feedback === 'down' ? null : 'down')}>
          <Icon name="thumb_down" size={12} /> 改進
        </button>
      </div>
    </div>
  )
}

export function AiSidekick({ open, onClose, contextPage, initialPrompt }: {
  open: boolean
  onClose: () => void
  contextPage: string
  initialPrompt?: string
}) {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'm0', role: 'ai', text: '你好！我是你的 AI 廣告助手。我已同步載入帳戶數據，可以幫你分析數據、診斷問題、或提供操作建議。', time: '09:14' }
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [activeHistory, setActiveHistory] = useState('h1')
  const [showCtx, setShowCtx] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && initialPrompt) { setInput(initialPrompt); setTimeout(() => textareaRef.current?.focus(), 400) }
  }, [open, initialPrompt])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  const send = useCallback((text?: string) => {
    const t = text ?? input
    if (!t.trim()) return
    const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    setMessages(p => [...p, { id: Date.now() + 'u', role: 'user', text: t, time: now }])
    setInput(''); setTyping(true)
    setTimeout(() => {
      const r = getAIResponse(t)
      setMessages(p => [...p, { id: Date.now() + 'a', role: 'ai', text: '', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }), response: r }])
      setTyping(false)
    }, 1400 + Math.random() * 600)
  }, [input])

  const ctxLabels: Record<string, string> = { overview: '總覽', diagnosis: '診斷建議', creative: '素材庫', time: '最佳時段', budget: '預算模擬', posts: '內容表現' }

  return (
    <div className={`ads-sk-drawer ${open ? 'open' : ''}`}>
      <div className="ads-sk-inner">
        <div className="ads-sk-history">
          <div className="ads-sk-history-header">對話紀錄</div>
          <button className="ads-sk-new-btn" onClick={() => { setMessages([{ id: 'm-new', role: 'ai', text: '新對話已開始，請問有什麼需要分析的？', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }]); setActiveHistory('') }}>
            <Icon name="plus" size={13} /> 新對話
          </button>
          <div className="ads-sk-history-list">
            {['今天', '昨天'].map(group => {
              const items = HISTORY.filter(h => h.date === group)
              if (!items.length) return null
              return (
                <div key={group}>
                  <div className="ads-sk-history-group">{group}</div>
                  {items.map(h => (
                    <div key={h.id} className={`ads-sk-history-item ${activeHistory === h.id ? 'active' : ''}`} onClick={() => setActiveHistory(h.id)}>
                      <div className="ads-sk-history-title">{h.title}</div>
                      <div className="ads-sk-history-meta">{h.time}</div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
        <div className="ads-sk-chat">
          <div className="ads-sk-header">
            <div className="ads-sk-header-avatar">✨</div>
            <div><div className="ads-sk-header-name">AI Sidekick</div><div className="ads-sk-header-sub">廣告投手助手</div></div>
            <button className="ads-sk-close-btn" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          {showCtx && (
            <div className="ads-sk-ctx-banner">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ad-blue)', flexShrink: 0, display: 'inline-block' }} />
              <span>已載入帳戶數據 · 當前頁面：{ctxLabels[contextPage] ?? '總覽'}</span>
              <span style={{ marginLeft: 'auto', cursor: 'pointer', opacity: 0.5 }} onClick={() => setShowCtx(false)}>×</span>
            </div>
          )}
          <div className="ads-sk-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`ads-sk-msg ${msg.role}`}>
                <div className="ads-sk-msg-avatar">{msg.role === 'ai' ? '✨' : '我'}</div>
                <div className="ads-sk-msg-bubble">
                  <div className="ads-sk-msg-text">
                    {msg.text && <p style={{ marginBottom: msg.response ? 8 : 0 }}>{msg.text}</p>}
                    {msg.response && <AiMessageBody r={msg.response} />}
                  </div>
                  <div className="ads-sk-msg-time">{msg.time}</div>
                </div>
              </div>
            ))}
            {typing && (
              <div className="ads-sk-msg ai">
                <div className="ads-sk-msg-avatar">✨</div>
                <div className="ads-sk-msg-bubble"><div className="ads-sk-typing"><span /><span /><span /></div></div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="ads-sk-suggestions">
            {SUGGESTIONS.map((s, i) => <div key={i} className="ads-sk-sug" onClick={() => send(s)}>{s}</div>)}
          </div>
          <div className="ads-sk-input-area">
            <div className="ads-sk-input-box">
              <textarea ref={textareaRef} className="ads-sk-textarea" rows={1} placeholder="問我任何廣告問題…"
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
              <button className="ads-sk-send-btn" onClick={() => send()} disabled={!input.trim()}>
                <Icon name="send" size={15} color="white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
