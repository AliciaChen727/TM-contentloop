'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { auth } from '@/lib/firebase/client'
import { Icon } from './Icon'

interface AiResponse {
  type: string
  summary: string
  bullets: string[]
  stats: { label: string; value: string }[]
  actions: string[]
  imagePrompt?: string
}

export interface MetricsContext {
  totalPosts?: number
  totalReach?: number
  totalLikes?: number
  totalComments?: number
  totalShares?: number
  avgEngRate?: number
  reelsCount?: number
  dateRange?: string
  topPosts?: { title: string; reach: number; likes: number; engRate: number; platform: string }[]
}

const SUGGESTIONS_BY_PAGE: Record<string, string[]> = {
  posts: ['這期間哪類貼文互動率最高？', '我的 Reels 和圖文貼文哪個表現更好？', '如何優化下一篇貼文的文案？', '分享數偏低的原因可能是什麼？'],
  creative: ['幫我生成一張廣告素材', '根據表現最差的廣告建議新素材方向', '如何改善 CTR 偏低的廣告圖？', '哪種圖文風格最適合這個受眾？'],
  default: ['這週廣告表現如何？', '哪個廣告組合應該增加預算？', '我的受眾是否疲乏了？', '幫我生成一張廣告素材'],
}

interface Message {
  id: string
  role: 'ai' | 'user'
  text: string
  time: string
  response?: AiResponse | null
  imageUrl?: string
  imageLoading?: boolean
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

export function AiSidekick({ open, onClose, contextPage, initialPrompt, metricsContext }: {
  open: boolean
  onClose: () => void
  contextPage: string
  initialPrompt?: string
  metricsContext?: MetricsContext
}) {
  const initMsg: Message = {
    id: 'm0', role: 'ai', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    text: contextPage === 'posts'
      ? '你好！我是你的 AI 內容顧問。我已載入你的貼文成效數據，可以幫你診斷問題、找出高互動內容特徵、或給下一篇貼文的優化建議。'
      : '你好！我是你的 AI 廣告助手。我已同步載入帳戶數據，可以幫你分析數據、診斷問題、或提供操作建議。',
  }

  const [messages, setMessages] = useState<Message[]>([initMsg])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [showCtx, setShowCtx] = useState(true)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const generateImage = useCallback(async (msgId: string, prompt: string) => {
    const user = auth.currentUser
    const idToken = user ? await user.getIdToken() : null
    if (!idToken) return
    try {
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      setMessages(p => p.map(m => m.id === msgId
        ? { ...m, imageLoading: false, imageUrl: data.imageData ? `data:${data.mimeType};base64,${data.imageData}` : undefined }
        : m))
    } catch {
      setMessages(p => p.map(m => m.id === msgId ? { ...m, imageLoading: false } : m))
    }
  }, [])

  useEffect(() => {
    if (open && initialPrompt) { setInput(initialPrompt); setTimeout(() => textareaRef.current?.focus(), 400) }
  }, [open, initialPrompt])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  const send = useCallback(async (text?: string) => {
    const t = text ?? input
    if (!t.trim()) return
    const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    setMessages(p => [...p, { id: Date.now() + 'u', role: 'user', text: t, time: now }])
    setInput('')
    setTyping(true)

    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      const res = await fetch('/api/ai/sidekick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ message: t, contextPage, metricsContext }),
      })
      const data = await res.json()
      if (!res.ok) {
        const errMsg = data.error ?? `伺服器錯誤 (${res.status})`
        setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: errMsg, time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }])
        return
      }
      const r: AiResponse = data.response ?? { type: 'general', summary: '抱歉，無法取得回應，請稍後再試。', bullets: [], stats: [], actions: [] }
      const aiMsgId = String(Date.now()) + 'a'
      const aiTime = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
      setMessages(p => [...p, { id: aiMsgId, role: 'ai', text: '', time: aiTime, response: r, imageLoading: r.type === 'image_request' }])
      if (r.type === 'image_request' && r.imagePrompt) generateImage(aiMsgId, r.imagePrompt)
    } catch {
      setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: '網路錯誤，請稍後再試。', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }])
    } finally {
      setTyping(false)
    }
  }, [input, contextPage, metricsContext, generateImage])

  const suggestions = SUGGESTIONS_BY_PAGE[contextPage] ?? SUGGESTIONS_BY_PAGE.default
  const ctxLabels: Record<string, string> = { overview: '總覽', diagnosis: '診斷建議', creative: '素材庫', time: '最佳時段', budget: '預算模擬', posts: '內容表現' }

  return (
    <div className={`ads-sk-drawer ${open ? 'open' : ''}`}>
      <div className="ads-sk-inner">
        <div className="ads-sk-chat" style={{ width: '100%' }}>
          <div className="ads-sk-header">
            <div className="ads-sk-header-avatar">✨</div>
            <div><div className="ads-sk-header-name">AI Sidekick</div><div className="ads-sk-header-sub">{contextPage === 'posts' ? '內容優化顧問' : '廣告投手助手'}</div></div>
            <button className="ads-sk-close-btn" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          {showCtx && (
            <div className="ads-sk-ctx-banner">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ad-blue)', flexShrink: 0, display: 'inline-block' }} />
              <span>已載入真實數據 · 當前頁面：{ctxLabels[contextPage] ?? '總覽'}</span>
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
                    {msg.imageLoading && (
                      <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--ad-text3)' }}>🎨 生成圖片中⋯</div>
                    )}
                    {msg.imageUrl && (
                      <div style={{ marginTop: 8 }}>
                        <img src={msg.imageUrl} alt="生成的廣告素材" style={{ width: '100%', borderRadius: 8 }} />
                        <textarea
                          value={editedPrompts[msg.id] ?? (msg.response?.imagePrompt ?? '')}
                          onChange={e => setEditedPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                          style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit' }}
                        />
                        <button className="ads-btn" style={{ marginTop: 6, fontSize: 12 }} onClick={() => {
                          const prompt = editedPrompts[msg.id] ?? msg.response?.imagePrompt ?? ''
                          if (!prompt) return
                          setMessages(p => p.map(m => m.id === msg.id ? { ...m, imageUrl: undefined, imageLoading: true } : m))
                          generateImage(msg.id, prompt)
                        }}>↻ 重新生成</button>
                      </div>
                    )}
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
            {suggestions.map((s, i) => <div key={i} className="ads-sk-sug" onClick={() => send(s)}>{s}</div>)}
          </div>
          <div className="ads-sk-input-area">
            <div className="ads-sk-input-box">
              <textarea ref={textareaRef} className="ads-sk-textarea" rows={1} placeholder="問我任何問題…"
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send() } }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
              <button className="ads-sk-send-btn" onClick={() => send()} disabled={!input.trim() || typing}>
                <Icon name="send" size={15} color="white" />
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 4, paddingRight: 2 }}>Enter 換行　Shift+Enter 送出</div>
          </div>
        </div>
      </div>
    </div>
  )
}
