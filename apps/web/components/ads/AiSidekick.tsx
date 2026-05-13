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
  videoPrompt?: string
  videoDuration?: number
}

export interface MetricsContext {
  // Posts context
  totalPosts?: number
  totalReach?: number
  totalLikes?: number
  totalComments?: number
  totalShares?: number
  avgEngRate?: number
  reelsCount?: number
  dateRange?: string
  topPosts?: { title: string; reach: number; likes: number; engRate: number; platform: string }[]
  // Ads context
  spend?: number
  roas?: number
  cpa?: number
  ctr?: number
  cpm?: number
  impressions?: number
  frequency?: number
  conversions?: number
  revenue?: number
  topCreatives?: { name: string; roas: number; spend: number; ctr: number; cpa: number }[]
}

interface FileAttachment {
  type: 'image' | 'pdf' | 'text'
  mimeType: string
  content: string
  name: string
}

interface HistoryTurn { question: string; summary: string }
interface HistorySession { sessionId: string; date: string; contextPage: string; turns: HistoryTurn[] }

const SUGGESTIONS_BY_PAGE: Record<string, string[]> = {
  posts: ['這期間哪類貼文互動率最高？', '我的 Reels 和圖文貼文哪個表現更好？', '如何優化下一篇貼文的文案？', '分享數偏低的原因可能是什麼？'],
  creative: ['幫我生成一張廣告素材', '根據表現最差的廣告建議新素材方向', '如何改善 CTR 偏低的廣告圖？', '哪種圖文風格最適合這個受眾？'],
  default: ['這週廣告表現如何？', '哪個廣告組合應該增加預算？', '我的受眾是否疲乏了？', '幫我生成一張廣告素材'],
}

const CTX_LABELS: Record<string, string> = { overview: '總覽', diagnosis: '診斷建議', creative: '素材庫', time: '最佳時段', budget: '預算模擬', posts: '內容表現' }

const SIZE_LIMITS: Record<string, number> = { image: 4 * 1024 * 1024, pdf: 10 * 1024 * 1024, text: 1 * 1024 * 1024 }

interface Message {
  id: string
  role: 'ai' | 'user'
  text: string
  time: string
  response?: AiResponse | null
  imageUrl?: string
  imageLoading?: boolean
  videoUrl?: string
  videoLoading?: boolean
  videoDuration?: number
  filePreview?: { name: string; type: string }
}

function AiMessageBody({ r, onSend }: { r: AiResponse; onSend: (text: string) => void }) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [otherText, setOtherText] = useState('')
  const [sent, setSent] = useState<number | 'other' | null>(null)

  function handleAction(text: string, idx: number) {
    if (sent !== null) return
    setSent(idx)
    onSend(text)
  }

  function handleOtherSubmit() {
    if (!otherText.trim() || sent !== null) return
    setSent('other')
    onSend(otherText.trim())
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      {r.summary && <p style={{ marginBottom: r.bullets.length ? 8 : 0 }}>{r.summary.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').trim()}</p>}
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
            <button key={i} className={`ads-sk-action-item${sent === i ? ' done' : ''}`} disabled={sent !== null} onClick={() => handleAction(a, i)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: sent !== null ? 'default' : 'pointer', padding: 0 }}>
              <div className="ads-sk-action-cb">{sent === i && <span style={{ fontSize: 10 }}>✓</span>}</div>
              <div className="ads-sk-action-text">{a}</div>
            </button>
          ))}
          {sent === null && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={otherText} onChange={e => setOtherText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleOtherSubmit() }} placeholder="其他問題…"
                style={{ flex: 1, fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--ad-border)', outline: 'none', background: 'var(--ad-bg)', color: 'var(--ad-text)', fontFamily: 'inherit' }} />
              <button onClick={handleOtherSubmit} disabled={!otherText.trim()}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--ad-blue)', color: '#fff', border: 'none', cursor: otherText.trim() ? 'pointer' : 'default', opacity: otherText.trim() ? 1 : 0.4, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                送出
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ads-sk-feedback">
        <button className={`ads-sk-fb-btn ${feedback === 'up' ? 'liked' : ''}`} onClick={() => setFeedback(feedback === 'up' ? null : 'up')}><Icon name="thumb_up" size={12} /> 有幫助</button>
        <button className={`ads-sk-fb-btn ${feedback === 'down' ? 'disliked' : ''}`} onClick={() => setFeedback(feedback === 'down' ? null : 'down')}><Icon name="thumb_down" size={12} /> 改進</button>
      </div>
    </div>
  )
}

export function AiSidekick({ open, onClose, contextPage, initialPrompt, autoSendPrompt, metricsContext }: {
  open: boolean
  onClose: () => void
  contextPage: string
  initialPrompt?: string
  autoSendPrompt?: string
  metricsContext?: MetricsContext
}) {
  const initMsg = useCallback((): Message => ({
    id: 'm0', role: 'ai', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    text: contextPage === 'posts'
      ? '你好！我是你的 AI 內容顧問。我已載入你的貼文成效數據，可以幫你診斷問題、找出高互動內容特徵、或給下一篇貼文的優化建議。'
      : '你好！我是你的 AI 廣告助手。我已同步載入帳戶數據，可以幫你分析數據、診斷問題、或提供操作建議。',
  }), [contextPage])

  const [messages, setMessages] = useState<Message[]>(() => [initMsg()])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [showCtx, setShowCtx] = useState(true)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [editedVideoPrompts, setEditedVideoPrompts] = useState<Record<string, string>>({})
  const [editedDurations, setEditedDurations] = useState<Record<string, number>>({})
  const [fileAttachment, setFileAttachment] = useState<FileAttachment | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const autoSentRef = useRef<string>('')

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

  const generateVideo = useCallback(async (msgId: string, prompt: string, duration: number) => {
    const user = auth.currentUser
    if (!user) return
    try {
      const idToken = await user.getIdToken()
      const submitRes = await fetch('/api/ai/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ prompt, durationSeconds: duration }),
      })
      const submitData = await submitRes.json()
      if (!submitRes.ok || !submitData.operationName) {
        setMessages(p => p.map(m => m.id === msgId ? { ...m, videoLoading: false } : m))
        return
      }
      const operationName: string = submitData.operationName
      let attempts = 0
      const interval = setInterval(async () => {
        attempts++
        if (attempts > 18) {
          clearInterval(interval)
          setMessages(p => p.map(m => m.id === msgId ? { ...m, videoLoading: false } : m))
          return
        }
        try {
          const token = await user.getIdToken()
          const pollRes = await fetch(`/api/ai/video?op=${encodeURIComponent(operationName)}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const pollData = await pollRes.json()
          if (pollData.done && pollData.videoData) {
            clearInterval(interval)
            setMessages(p => p.map(m => m.id === msgId
              ? { ...m, videoLoading: false, videoUrl: `data:${pollData.mimeType ?? 'video/mp4'};base64,${pollData.videoData}` }
              : m))
          } else if (!pollRes.ok) {
            clearInterval(interval)
            setMessages(p => p.map(m => m.id === msgId ? { ...m, videoLoading: false } : m))
          }
        } catch { /* continue polling */ }
      }, 10000)
    } catch {
      setMessages(p => p.map(m => m.id === msgId ? { ...m, videoLoading: false } : m))
    }
  }, [])

  const send = useCallback(async (text?: string, attachment?: FileAttachment | null) => {
    const t = text ?? input
    const att = attachment !== undefined ? attachment : fileAttachment
    if (!t.trim() && !att) return
    const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    setMessages(p => [...p, {
      id: Date.now() + 'u', role: 'user', text: t, time: now,
      filePreview: att ? { name: att.name, type: att.type } : undefined,
    }])
    setInput('')
    setFileAttachment(null)
    setTyping(true)

    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      const res = await fetch('/api/ai/sidekick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ message: t, contextPage, metricsContext, fileAttachment: att ?? undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: data.error ?? `伺服器錯誤 (${res.status})`, time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }])
        return
      }
      const raw = data.response ?? { type: 'general', summary: '抱歉，無法取得回應，請稍後再試。', bullets: [], stats: [], actions: [] }
      const r: AiResponse = { ...raw, bullets: Array.isArray(raw.bullets) ? raw.bullets : [], stats: Array.isArray(raw.stats) ? raw.stats : [], actions: Array.isArray(raw.actions) ? raw.actions : [] }
      const aiMsgId = String(Date.now()) + 'a'
      setMessages(p => [...p, { id: aiMsgId, role: 'ai', text: '', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }), response: r, imageLoading: r.type === 'image_request', videoLoading: r.type === 'video_request', videoDuration: r.videoDuration }])
      if (r.type === 'image_request' && r.imagePrompt) generateImage(aiMsgId, r.imagePrompt)
      if (r.type === 'video_request' && r.videoPrompt) generateVideo(aiMsgId, r.videoPrompt, r.videoDuration ?? 5)
    } catch {
      setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: '網路錯誤，請稍後再試。', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }])
    } finally {
      setTyping(false)
    }
  }, [input, fileAttachment, contextPage, metricsContext, generateImage, generateVideo])

  // Auto-send when creative pin triggers
  useEffect(() => {
    if (open && autoSendPrompt && autoSendPrompt !== autoSentRef.current) {
      autoSentRef.current = autoSendPrompt
      setMessages([initMsg()])
      setTimeout(() => send(autoSendPrompt, null), 300)
    }
  }, [open, autoSendPrompt, send, initMsg])

  // Fill textarea for regular initialPrompt (non-auto-send)
  useEffect(() => {
    if (open && initialPrompt && !autoSendPrompt) {
      setInput(initialPrompt)
      setTimeout(() => textareaRef.current?.focus(), 400)
    }
  }, [open, initialPrompt, autoSendPrompt])

  // Auto-focus textarea on open so Ctrl+V paste works immediately
  useEffect(() => {
    if (open && !autoSendPrompt && !showHistory) {
      setTimeout(() => textareaRef.current?.focus(), 350)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  // Load history
  useEffect(() => {
    if (!showHistory) return
    setHistoryLoading(true)
    auth.currentUser?.getIdToken().then(idToken => {
      fetch('/api/ai/history', { headers: { Authorization: `Bearer ${idToken}` } })
        .then(r => r.json())
        .then(d => setHistorySessions(d.sessions ?? []))
        .catch(() => {})
        .finally(() => setHistoryLoading(false))
    })
  }, [showHistory])

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(item => item.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    if (file.size > SIZE_LIMITS.image) { alert('圖片不能超過 4MB'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setFileAttachment({ type: 'image', mimeType: file.type || 'image/png', content: dataUrl.split(',')[1], name: file.name || 'paste.png' })
    }
    reader.readAsDataURL(file)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const isImage = file.type.startsWith('image/')
    const isPdf = file.type === 'application/pdf'
    const isText = file.type === 'text/csv' || file.type === 'application/json' || file.name.endsWith('.csv') || file.name.endsWith('.json')

    if (!isImage && !isPdf && !isText) { alert('只支援 PNG/JPG/PDF/CSV/JSON 格式'); return }

    const attType: FileAttachment['type'] = isImage ? 'image' : isPdf ? 'pdf' : 'text'
    const limit = SIZE_LIMITS[attType]
    if (file.size > limit) { alert(`檔案過大（上限 ${limit / 1024 / 1024}MB）`); return }

    const reader = new FileReader()
    if (isText) {
      reader.readAsText(file)
      reader.onload = () => setFileAttachment({ type: 'text', mimeType: file.type || 'text/plain', content: reader.result as string, name: file.name })
    } else {
      reader.readAsDataURL(file)
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1]
        setFileAttachment({ type: attType, mimeType: file.type, content: base64, name: file.name })
      }
    }
  }

  function loadHistorySession(session: HistorySession) {
    const msgs: Message[] = [initMsg()]
    session.turns.forEach((turn, i) => {
      const t = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
      msgs.push({ id: `h-u-${i}`, role: 'user', text: turn.question, time: t })
      msgs.push({ id: `h-a-${i}`, role: 'ai', text: turn.summary, time: t })
    })
    setMessages(msgs)
    setShowHistory(false)
  }

  const suggestions = SUGGESTIONS_BY_PAGE[contextPage] ?? SUGGESTIONS_BY_PAGE.default

  return (
    <div className={`ads-sk-drawer ${open ? 'open' : ''}`}>
      <div className="ads-sk-inner">
        <div className="ads-sk-chat" style={{ width: '100%' }}>
          {/* Header */}
          <div className="ads-sk-header">
            <div className="ads-sk-header-avatar">✨</div>
            <div>
              <div className="ads-sk-header-name">AI Sidekick</div>
              <div className="ads-sk-header-sub">{contextPage === 'posts' ? '內容優化顧問' : '廣告投手助手'}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                title="對話歷史"
                onClick={() => setShowHistory(v => !v)}
                style={{ background: showHistory ? 'var(--ad-blue)' : 'none', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: showHistory ? '#fff' : 'var(--ad-text2)' }}
              >🕐 歷史</button>
              {!showHistory && (
                <button
                  title="新對話"
                  onClick={() => { setMessages([initMsg()]); setInput(''); setFileAttachment(null) }}
                  style={{ background: 'none', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: 'var(--ad-text2)' }}
                >+ 新對話</button>
              )}
              <button className="ads-sk-close-btn" onClick={onClose}><Icon name="close" size={14} /></button>
            </div>
          </div>

          {/* History panel */}
          {showHistory ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--ad-text3)', marginBottom: 4 }}>點擊任一紀錄可還原對話</p>
              {historyLoading && <p style={{ fontSize: 13, color: 'var(--ad-text3)', textAlign: 'center', padding: 24 }}>載入中⋯</p>}
              {!historyLoading && historySessions.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--ad-text3)', textAlign: 'center', padding: 24 }}>尚無歷史紀錄</p>
              )}
              {historySessions.map(session => (
                <button key={session.sessionId} onClick={() => loadHistorySession(session)}
                  style={{ textAlign: 'left', background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ad-text3)' }}>
                    <span>{CTX_LABELS[session.contextPage] ?? session.contextPage}</span>
                    <span>{session.date}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ad-text)', fontWeight: 500 }}>{session.turns[0]?.question.slice(0, 50) ?? '（無內容）'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{session.turns.length} 則對話</div>
                </button>
              ))}
            </div>
          ) : (
            <>
              {showCtx && (
                <div className="ads-sk-ctx-banner">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ad-blue)', flexShrink: 0, display: 'inline-block' }} />
                  <span>已載入真實數據 · 當前頁面：{CTX_LABELS[contextPage] ?? '總覽'}</span>
                  <span style={{ marginLeft: 'auto', cursor: 'pointer', opacity: 0.5 }} onClick={() => setShowCtx(false)}>×</span>
                </div>
              )}

              {/* Messages */}
              <div className="ads-sk-messages">
                {messages.map(msg => (
                  <div key={msg.id} className={`ads-sk-msg ${msg.role}`}>
                    <div className="ads-sk-msg-avatar">{msg.role === 'ai' ? '✨' : '我'}</div>
                    <div className="ads-sk-msg-bubble">
                      <div className="ads-sk-msg-text">
                        {msg.filePreview && (
                          <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            📎 {msg.filePreview.name}
                          </div>
                        )}
                        {msg.text && <p style={{ marginBottom: msg.response ? 8 : 0 }}>{msg.text}</p>}
                        {msg.response && <AiMessageBody r={msg.response} onSend={send} />}
                        {msg.imageLoading && <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--ad-text3)' }}>🎨 生成圖片中⋯</div>}
                        {msg.imageUrl && (
                          <div style={{ marginTop: 8 }}>
                            <img src={msg.imageUrl} alt="生成的廣告素材" style={{ width: '100%', borderRadius: 8 }} />
                            <textarea value={editedPrompts[msg.id] ?? (msg.response?.imagePrompt ?? '')}
                              onChange={e => setEditedPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                              style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                            <button className="ads-btn" style={{ marginTop: 6, fontSize: 12 }} onClick={() => {
                              const prompt = editedPrompts[msg.id] ?? msg.response?.imagePrompt ?? ''
                              if (!prompt) return
                              setMessages(p => p.map(m => m.id === msg.id ? { ...m, imageUrl: undefined, imageLoading: true } : m))
                              generateImage(msg.id, prompt)
                            }}>↻ 重新生成</button>
                          </div>
                        )}
                        {msg.videoLoading && <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--ad-text3)' }}>🎬 生成 Reels 中⋯ 預計需要 1–3 分鐘</div>}
                        {msg.videoUrl && (
                          <div style={{ marginTop: 8 }}>
                            <video src={msg.videoUrl} controls playsInline style={{ width: '100%', borderRadius: 8, display: 'block', maxHeight: 400 }} />
                            <textarea value={editedVideoPrompts[msg.id] ?? (msg.response?.videoPrompt ?? '')}
                              onChange={e => setEditedVideoPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                              style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                              <select value={editedDurations[msg.id] ?? (msg.videoDuration ?? 5)}
                                onChange={e => setEditedDurations(p => ({ ...p, [msg.id]: Number(e.target.value) }))}
                                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', background: 'var(--ad-surface)', color: 'var(--ad-text)', cursor: 'pointer' }}>
                                {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>{s} 秒</option>)}
                              </select>
                              <button className="ads-btn" style={{ fontSize: 12, flex: 1 }} onClick={() => {
                                const prompt = editedVideoPrompts[msg.id] ?? msg.response?.videoPrompt ?? ''
                                if (!prompt) return
                                const dur = editedDurations[msg.id] ?? msg.videoDuration ?? 5
                                setMessages(p => p.map(m => m.id === msg.id ? { ...m, videoUrl: undefined, videoLoading: true } : m))
                                generateVideo(msg.id, prompt, dur)
                              }}>↻ 重新生成</button>
                              <a href={msg.videoUrl} download="reels.mp4"
                                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', color: 'var(--ad-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                ⬇ 下載 MP4
                              </a>
                            </div>
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

              {/* Suggestions */}
              <div className="ads-sk-suggestions">
                {suggestions.map((s, i) => <div key={i} className="ads-sk-sug" onClick={() => send(s)}>{s}</div>)}
              </div>

              {/* Input area */}
              <div className="ads-sk-input-area">
                {fileAttachment && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '5px 10px', background: 'var(--ad-surface)', borderRadius: 8, border: '1px solid var(--ad-border)', fontSize: 12 }}>
                    <span>{fileAttachment.type === 'image' ? '🖼️' : fileAttachment.type === 'pdf' ? '📄' : '📊'}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ad-text2)' }}>{fileAttachment.name}</span>
                    <button onClick={() => setFileAttachment(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                )}
                <div className="ads-sk-input-box">
                  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf,.csv,.json" style={{ display: 'none' }} onChange={handleFileSelect} />
                  <button title="上傳檔案" onClick={() => fileInputRef.current?.click()}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 6px', color: 'var(--ad-text3)', fontSize: 16, flexShrink: 0 }}>📎</button>
                  <textarea ref={textareaRef} className="ads-sk-textarea" rows={1} placeholder="問我任何問題…"
                    value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send() } }}
                    onPaste={handlePaste}
                    onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
                  <button className="ads-sk-send-btn" onClick={() => send()} disabled={(!input.trim() && !fileAttachment) || typing}>
                    <Icon name="send" size={15} color="white" />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 4, paddingRight: 2 }}>Enter 換行　Shift+Enter 送出</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
