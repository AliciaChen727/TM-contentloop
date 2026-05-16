'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { auth } from '@/lib/firebase/client'
import { uploadVideoForAnalysis } from '@/lib/firebase/storage'
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
  type: 'image' | 'pdf' | 'text' | 'video'
  mimeType: string
  content: string
  name: string
  videoUrl?: string
}

interface HistoryTurn { question: string; summary: string }
interface HistorySession { sessionId: string; date: string; contextPage: string; turns: HistoryTurn[] }

const SUGGESTIONS_BY_PAGE: Record<string, string[]> = {
  posts: ['這期間哪類貼文互動率最高？', '我的 Reels 和圖文貼文哪個表現更好？', '如何優化下一篇貼文的文案？', '分享數偏低的原因可能是什麼？'],
  creative: ['幫我生成一張廣告素材', '根據表現最差的廣告建議新素材方向', '如何改善 CTR 偏低的廣告圖？', '哪種圖文風格最適合這個受眾？'],
  default: ['這週廣告表現如何？', '哪個廣告組合應該增加預算？', '我的受眾是否疲乏了？', '幫我生成一張廣告素材'],
}

const CTX_LABELS: Record<string, string> = { overview: '總覽', diagnosis: '診斷建議', creative: '素材庫', time: '最佳時段', budget: '預算模擬', posts: '內容表現' }

const SIZE_LIMITS: Record<string, number> = { image: 4 * 1024 * 1024, pdf: 10 * 1024 * 1024, text: 1 * 1024 * 1024, video: 30 * 1024 * 1024 }
const MAX_FILES = 5
const FILE_EMOJI: Record<string, string> = { image: '🖼️', pdf: '📄', text: '📊', video: '🎬' }

interface Message {
  id: string
  role: 'ai' | 'user'
  text: string
  time: string
  response?: AiResponse | null
  imageUrl?: string
  imageLoading?: boolean
  imageError?: string
  videoUrl?: string
  videoLoading?: boolean
  videoDuration?: number
  filePreviews?: { name: string; type: string }[]
  noApiKey?: boolean
}

function renderWithLinks(text: string): React.ReactNode {
  const parts = text.split(/(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g)
  const result: React.ReactNode[] = []
  let i = 0
  while (i < parts.length) {
    if (parts[i].startsWith('[') && i + 2 < parts.length) {
      result.push(<a key={i} href={parts[i + 2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ad-blue)', textDecoration: 'underline' }}>{parts[i + 1]}</a>)
      i += 3
    } else {
      if (parts[i]) result.push(parts[i])
      i++
    }
  }
  return result
}

function AiMessageBody({ r, onSend }: { r: AiResponse; onSend: (text: string) => void }) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [inputs, setInputs] = useState<Record<number, string>>({})
  const [otherText, setOtherText] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function toggleChecked(i: number) {
    if (submitted) return
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function handleSubmit() {
    if (submitted) return
    const parts: string[] = []
    for (const i of Array.from(checked).sort((a, b) => a - b)) {
      const detail = (inputs[i] ?? '').trim()
      parts.push(detail ? `- ${r.actions[i]}：${detail}` : `- ${r.actions[i]}`)
    }
    const other = otherText.trim()
    if (other) parts.push(`其他補充：${other}`)
    if (parts.length === 0) return
    setSubmitted(true)
    onSend(parts.join('\n'))
  }

  function handleForceGenerate() {
    if (submitted) return
    setSubmitted(true)
    onSend('直接生成（不需澄清，請依目前上下文使用合理預設值直接生成素材）')
  }

  const submitCount = checked.size + (otherText.trim() ? 1 : 0)

  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      {r.summary && <p style={{ marginBottom: r.bullets.length ? 8 : 0 }}>{renderWithLinks(r.summary.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').trim())}</p>}
      {r.bullets.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {r.bullets.map((b, i) => <li key={i} style={{ display: 'flex', gap: 6 }}><span style={{ color: 'var(--ad-blue)' }}>▸</span><span>{renderWithLinks(b)}</span></li>)}
        </ul>
      )}
      {r.stats.length > 0 && (
        <div className="ads-sk-stat-row">
          {r.stats.map((s, i) => <div key={i} className="ads-sk-stat"><div className="ads-sk-stat-label">{s.label}</div><div className="ads-sk-stat-value">{s.value}</div></div>)}
        </div>
      )}
      {r.actions.length > 0 && (
        <div className="ads-sk-action-list">
          {r.actions.map((a, i) => {
            const isChecked = checked.has(i)
            return (
              <div key={i} style={{ marginBottom: 4 }}>
                <button onClick={() => toggleChecked(i)} disabled={submitted}
                  className={`ads-sk-action-item${isChecked ? ' done' : ''}`}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: submitted ? 'default' : 'pointer', padding: 0 }}>
                  <div className="ads-sk-action-cb">{isChecked && <span style={{ fontSize: 10 }}>✓</span>}</div>
                  <div className="ads-sk-action-text">{a}</div>
                </button>
                {isChecked && !submitted && (
                  <textarea rows={1} value={inputs[i] ?? ''}
                    onChange={e => setInputs(p => ({ ...p, [i]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                    onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 100) + 'px' }}
                    placeholder="請輸入詳細內容…"
                    style={{ width: 'calc(100% - 24px)', fontSize: 12, padding: '6px 10px', marginTop: 4, marginLeft: 24, borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'none', minHeight: 32, boxSizing: 'border-box', fontFamily: 'inherit', background: 'var(--ad-bg)', color: 'var(--ad-text)', outline: 'none' }} />
                )}
              </div>
            )
          })}
          {!submitted && (
            <div style={{ marginTop: 6 }}>
              <textarea rows={1} value={otherText} onChange={e => setOtherText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleSubmit() } }} placeholder="其他補充（選填）…"
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }}
                style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--ad-border)', outline: 'none', background: 'var(--ad-bg)', color: 'var(--ad-text)', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 10, color: 'var(--ad-text3)' }}>Enter 換行　Shift+Enter 送出</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleForceGenerate}
                    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--ad-surface)', color: 'var(--ad-text2)', border: '1px solid var(--ad-border)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    ⚡ 直接生成
                  </button>
                  <button onClick={handleSubmit} disabled={submitCount === 0}
                    style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--ad-blue)', color: '#fff', border: 'none', cursor: submitCount === 0 ? 'default' : 'pointer', opacity: submitCount === 0 ? 0.4 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    送出{submitCount > 0 ? ` (${submitCount} 項)` : ''}
                  </button>
                </div>
              </div>
            </div>
          )}
          {submitted && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ad-text3)' }}>✓ 已送出回覆</div>
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
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([])
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoUploadPct, setVideoUploadPct] = useState(0)
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
      if (!res.ok || !data.imageData) {
        setMessages(p => p.map(m => m.id === msgId
          ? { ...m, imageLoading: false, noApiKey: data.error === 'NO_API_KEY' || undefined, imageError: data.error === 'NO_API_KEY' ? undefined : (data.error ?? '圖片生成失敗，請重試') }
          : m))
        return
      }
      setMessages(p => p.map(m => m.id === msgId
        ? { ...m, imageLoading: false, imageUrl: `data:${data.mimeType};base64,${data.imageData}` }
        : m))
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '網路錯誤'
      setMessages(p => p.map(m => m.id === msgId ? { ...m, imageLoading: false, imageError: errMsg } : m))
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
        setMessages(p => p.map(m => m.id === msgId ? {
          ...m, videoLoading: false,
          noApiKey: submitData.error === 'NO_API_KEY' || undefined,
          text: submitData.error === 'NO_API_KEY' ? '' : (submitData.error ?? '影片生成失敗'),
        } : m))
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

  const send = useCallback(async (text?: string) => {
    const t = text ?? input
    const atts = fileAttachments
    if (!t.trim() && atts.length === 0) return
    const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })

    // Build conversation history for multi-turn context (exclude init/special messages, cap at 10)
    const history = messages
      .filter(m => m.id !== 'm0' && !m.noApiKey && !m.imageLoading && !m.videoLoading)
      .slice(-10)
      .map(m => {
        if (m.role === 'user') return { role: 'user' as const, text: m.text }
        if (m.response) {
          const parts = [m.response.summary, ...m.response.bullets.slice(0, 2)].filter(Boolean)
          return { role: 'assistant' as const, text: parts.join('\n') }
        }
        return m.text ? { role: 'assistant' as const, text: m.text } : null
      })
      .filter((m): m is { role: 'user' | 'assistant'; text: string } => m !== null && !!m.text)

    setMessages(p => [...p, {
      id: Date.now() + 'u', role: 'user', text: t, time: now,
      filePreviews: atts.length > 0 ? atts.map(a => ({ name: a.name, type: a.type })) : undefined,
    }])
    setInput('')
    setFileAttachments([])
    setTyping(true)

    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      const res = await fetch('/api/ai/sidekick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ message: t, contextPage, metricsContext, fileAttachments: atts.length > 0 ? atts : undefined, history }),
      })
      const data = await res.json()
      if (!res.ok) {
        const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
        if (data.error === 'NO_API_KEY') {
          setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: '', time: now, noApiKey: true }])
        } else {
          setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: data.error ?? `伺服器錯誤 (${res.status})`, time: now }])
        }
        return
      }
      const raw = data.response ?? { type: 'general', summary: '抱歉，無法取得回應，請稍後再試。', bullets: [], stats: [], actions: [] }
      const r: AiResponse = { ...raw, bullets: Array.isArray(raw.bullets) ? raw.bullets : [], stats: Array.isArray(raw.stats) ? raw.stats : [], actions: Array.isArray(raw.actions) ? raw.actions : [] }
      const aiMsgId = String(Date.now()) + 'a'
      setMessages(p => [...p, { id: aiMsgId, role: 'ai', text: '', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }), response: r, imageLoading: false, videoLoading: false, videoDuration: r.videoDuration }])
    } catch {
      setMessages(p => [...p, { id: Date.now() + 'e', role: 'ai', text: '網路錯誤，請稍後再試。', time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }])
    } finally {
      setTyping(false)
    }
  }, [input, fileAttachments, contextPage, metricsContext, messages])

  // Auto-send when creative pin triggers
  useEffect(() => {
    if (open && autoSendPrompt && autoSendPrompt !== autoSentRef.current) {
      autoSentRef.current = autoSendPrompt
      setMessages([initMsg()])
      setFileAttachments([])
      setTimeout(() => send(autoSendPrompt), 300)
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

  // Check API key on open — show prompt immediately if not set
  useEffect(() => {
    if (!open) return
    auth.currentUser?.getIdToken().then(async idToken => {
      const res = await fetch('/api/user/api-keys', { headers: { Authorization: `Bearer ${idToken}` } })
      if (!res.ok) return
      const data = await res.json()
      if (!data.anthropic) {
        const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
        setMessages(prev => {
          const alreadyHasPrompt = prev.some(m => m.noApiKey)
          if (alreadyHasPrompt) return prev
          return [...prev, { id: 'no-key', role: 'ai', text: '', time: now, noApiKey: true }]
        })
      }
    }).catch(() => {})
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
    if (fileAttachments.length >= MAX_FILES) { alert(`最多同時附加 ${MAX_FILES} 個檔案`); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setFileAttachments(prev => [...prev, { type: 'image', mimeType: file.type || 'image/png', content: dataUrl.split(',')[1], name: file.name || 'paste.png' }])
    }
    reader.readAsDataURL(file)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    const remaining = MAX_FILES - fileAttachments.length
    if (remaining <= 0) { alert(`最多同時附加 ${MAX_FILES} 個檔案`); return }
    const toProcess = files.slice(0, remaining)
    if (files.length > remaining) alert(`已選 ${files.length} 個，只取前 ${remaining} 個（最多 ${MAX_FILES} 個）`)

    for (const file of toProcess) {
      const isImage = file.type.startsWith('image/')
      const isPdf = file.type === 'application/pdf'
      const isText = file.type === 'text/csv' || file.type === 'application/json' || file.name.endsWith('.csv') || file.name.endsWith('.json')
      const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.mov') || file.name.endsWith('.webm')

      if (!isImage && !isPdf && !isText && !isVideo) { alert(`「${file.name}」格式不支援，只接受 PNG/JPG/PDF/CSV/JSON/MP4/MOV/WEBM`); continue }

      const attType: FileAttachment['type'] = isImage ? 'image' : isPdf ? 'pdf' : isText ? 'text' : 'video'
      if (file.size > SIZE_LIMITS[attType]) { alert(`「${file.name}」過大（上限 ${SIZE_LIMITS[attType] / 1024 / 1024}MB）`); continue }

      if (isVideo) {
        const user = auth.currentUser
        if (!user) { alert('請先登入'); continue }
        setVideoUploading(true)
        setVideoUploadPct(0)
        try {
          const url = await uploadVideoForAnalysis(user.uid, file, pct => setVideoUploadPct(Math.round(pct)))
          setFileAttachments(prev => [...prev, { type: 'video', mimeType: file.type || 'video/mp4', content: '', name: file.name, videoUrl: url }])
        } catch {
          alert(`「${file.name}」上傳失敗，請重試`)
        } finally {
          setVideoUploading(false)
        }
      } else if (isText) {
        const reader = new FileReader()
        reader.readAsText(file)
        reader.onload = () => setFileAttachments(prev => [...prev, { type: 'text', mimeType: file.type || 'text/plain', content: reader.result as string, name: file.name }])
      } else {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1]
          setFileAttachments(prev => [...prev, { type: attType, mimeType: file.type, content: base64, name: file.name }])
        }
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
                  onClick={() => { setMessages([initMsg()]); setInput(''); setFileAttachments([]) }}
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
                        {msg.filePreviews && msg.filePreviews.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
                            {msg.filePreviews.map((fp, i) => (
                              <div key={i} style={{ fontSize: 11, color: 'var(--ad-text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {FILE_EMOJI[fp.type] ?? '📎'} {fp.name}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.noApiKey && (
                          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                            <p style={{ marginBottom: 6 }}>⚠️ 請先到「設定」頁面輸入你的 Claude API Key 才能使用 AI Sidekick。</p>
                            <p style={{ color: 'var(--ad-text2)', fontSize: 12 }}>
                              前往頭像 → 設定 → API Keys（
                              <a href="https://tm-contentloop.vercel.app/dashboard/settings" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ad-blue)', textDecoration: 'underline' }}>
                                https://tm-contentloop.vercel.app/dashboard/settings
                              </a>
                              ）
                            </p>
                          </div>
                        )}
                        {!msg.noApiKey && msg.text && <p style={{ marginBottom: msg.response ? 8 : 0 }}>{msg.text}</p>}
                        {msg.response && <AiMessageBody r={msg.response} onSend={send} />}
                        {msg.response?.imagePrompt && !msg.imageLoading && !msg.imageUrl && !msg.imageError && (() => {
                          const fireImage = () => {
                            const prompt = editedPrompts[msg.id] ?? msg.response?.imagePrompt ?? ''
                            if (!prompt) return
                            setMessages(p => p.map(m => m.id === msg.id ? { ...m, imageLoading: true } : m))
                            generateImage(msg.id, prompt)
                          }
                          return (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', fontSize: 12 }}>
                              <div style={{ color: 'var(--ad-text3)', marginBottom: 6 }}>🖼️ 待生成圖片 — 可編輯提示詞後再生成</div>
                              <textarea value={editedPrompts[msg.id] ?? msg.response.imagePrompt}
                                onChange={e => setEditedPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); fireImage() } }}
                                style={{ width: '100%', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 6 }} />
                              <button className="ads-btn" style={{ fontSize: 12 }} onClick={fireImage}>✨ 生成圖片</button>
                              <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 4 }}>Enter 換行　Shift+Enter 送出</div>
                            </div>
                          )
                        })()}
                        {msg.response?.videoPrompt && !msg.videoLoading && !msg.videoUrl && (() => {
                          const fireVideo = () => {
                            const prompt = editedVideoPrompts[msg.id] ?? msg.response?.videoPrompt ?? ''
                            if (!prompt) return
                            const dur = editedDurations[msg.id] ?? msg.videoDuration ?? 5
                            setMessages(p => p.map(m => m.id === msg.id ? { ...m, videoLoading: true } : m))
                            generateVideo(msg.id, prompt, dur)
                          }
                          return (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', fontSize: 12 }}>
                              <div style={{ color: 'var(--ad-text3)', marginBottom: 6 }}>🎬 待生成 Reels — 可編輯提示詞與秒數後再生成</div>
                              <textarea value={editedVideoPrompts[msg.id] ?? msg.response.videoPrompt}
                                onChange={e => setEditedVideoPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); fireVideo() } }}
                                style={{ width: '100%', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 6 }} />
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <select value={editedDurations[msg.id] ?? (msg.videoDuration ?? 5)}
                                  onChange={e => setEditedDurations(p => ({ ...p, [msg.id]: Number(e.target.value) }))}
                                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', background: 'var(--ad-surface)', color: 'var(--ad-text)', cursor: 'pointer' }}>
                                  {[5,6,7,8].map(s => <option key={s} value={s}>{s} 秒</option>)}
                                </select>
                                <button className="ads-btn" style={{ fontSize: 12, flex: 1 }} onClick={fireVideo}>🎬 生成 Reels 影片</button>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--ad-text3)', textAlign: 'right', marginTop: 4 }}>Enter 換行　Shift+Enter 送出</div>
                            </div>
                          )
                        })()}
                        {msg.imageLoading && <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--ad-text3)' }}>🎨 生成圖片中⋯</div>}
                        {msg.imageError && (() => {
                          const retryImage = () => {
                            const prompt = editedPrompts[msg.id] ?? msg.response?.imagePrompt ?? ''
                            if (!prompt) return
                            setMessages(p => p.map(m => m.id === msg.id ? { ...m, imageError: undefined, imageLoading: true } : m))
                            generateImage(msg.id, prompt)
                          }
                          return (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12 }}>
                              <div style={{ color: '#ef4444', marginBottom: 6 }}>❌ {msg.imageError}</div>
                              {msg.response?.imagePrompt && (
                                <>
                                  <textarea
                                    defaultValue={msg.response.imagePrompt}
                                    style={{ width: '100%', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 6 }}
                                    onChange={e => setEditedPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); retryImage() } }}
                                  />
                                  <button className="ads-btn" style={{ fontSize: 12 }} onClick={retryImage}>↻ 重新生成</button>
                                </>
                              )}
                            </div>
                          )
                        })()}
                        {msg.imageUrl && (() => {
                          const regenImage = () => {
                            const prompt = editedPrompts[msg.id] ?? msg.response?.imagePrompt ?? ''
                            if (!prompt) return
                            setMessages(p => p.map(m => m.id === msg.id ? { ...m, imageUrl: undefined, imageLoading: true } : m))
                            generateImage(msg.id, prompt)
                          }
                          return (
                            <div style={{ marginTop: 8 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={msg.imageUrl} alt="生成的廣告素材" style={{ width: '100%', borderRadius: 8 }} />
                              <textarea value={editedPrompts[msg.id] ?? (msg.response?.imagePrompt ?? '')}
                                onChange={e => setEditedPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); regenImage() } }}
                                style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                              <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                                <button className="ads-btn" style={{ fontSize: 12, flex: 1 }} onClick={regenImage}>↻ 重新生成</button>
                                <a href={msg.imageUrl} download="ad-creative.jpg"
                                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', color: 'var(--ad-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                  ⬇ 下載圖片
                                </a>
                              </div>
                            </div>
                          )
                        })()}
                        {msg.videoLoading && <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--ad-text3)' }}>🎬 生成 Reels 中⋯ 預計需要 1–3 分鐘</div>}
                        {msg.videoUrl && (() => {
                          const regenVideo = () => {
                            const prompt = editedVideoPrompts[msg.id] ?? msg.response?.videoPrompt ?? ''
                            if (!prompt) return
                            const dur = editedDurations[msg.id] ?? msg.videoDuration ?? 5
                            setMessages(p => p.map(m => m.id === msg.id ? { ...m, videoUrl: undefined, videoLoading: true } : m))
                            generateVideo(msg.id, prompt, dur)
                          }
                          return (
                          <div style={{ marginTop: 8 }}>
                            <video src={msg.videoUrl} controls playsInline style={{ width: '100%', borderRadius: 8, display: 'block', maxHeight: 400 }} />
                            <textarea value={editedVideoPrompts[msg.id] ?? (msg.response?.videoPrompt ?? '')}
                              onChange={e => setEditedVideoPrompts(p => ({ ...p, [msg.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); regenVideo() } }}
                              style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                              <select value={editedDurations[msg.id] ?? (msg.videoDuration ?? 5)}
                                onChange={e => setEditedDurations(p => ({ ...p, [msg.id]: Number(e.target.value) }))}
                                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--ad-border)', background: 'var(--ad-surface)', color: 'var(--ad-text)', cursor: 'pointer' }}>
                                {[5,6,7,8].map(s => <option key={s} value={s}>{s} 秒</option>)}
                              </select>
                              <button className="ads-btn" style={{ fontSize: 12, flex: 1 }} onClick={regenVideo}>↻ 重新生成</button>
                              <a href={msg.videoUrl} download="reels.mp4"
                                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'var(--ad-surface)', border: '1px solid var(--ad-border)', color: 'var(--ad-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                ⬇ 下載 MP4
                              </a>
                            </div>
                          </div>
                          )
                        })()}
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
                {videoUploading && (
                  <div style={{ marginBottom: 6, padding: '5px 10px', background: 'var(--ad-surface)', borderRadius: 8, border: '1px solid var(--ad-border)', fontSize: 12, color: 'var(--ad-text2)' }}>
                    🎬 上傳影片中⋯ {videoUploadPct}%
                    <div style={{ marginTop: 4, height: 3, background: 'var(--ad-border)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${videoUploadPct}%`, background: 'var(--ad-blue)', borderRadius: 2, transition: 'width 0.2s' }} />
                    </div>
                  </div>
                )}
                {fileAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {fileAttachments.map((att, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'var(--ad-surface)', borderRadius: 6, border: '1px solid var(--ad-border)', fontSize: 12 }}>
                        <span>{FILE_EMOJI[att.type] ?? '📎'}</span>
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ad-text2)' }}>{att.name}</span>
                        <button onClick={() => setFileAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="ads-sk-input-box">
                  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf,.csv,.json,.mp4,.mov,.webm" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
                  <button title="上傳檔案" onClick={() => fileInputRef.current?.click()}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 6px', color: 'var(--ad-text3)', fontSize: 16, flexShrink: 0 }}>📎</button>
                  <textarea ref={textareaRef} className="ads-sk-textarea" rows={1} placeholder="問我任何問題…"
                    value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send() } }}
                    onPaste={handlePaste}
                    onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
                  <button className="ads-sk-send-btn" onClick={() => send()} disabled={(!input.trim() && fileAttachments.length === 0) || typing || videoUploading}>
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
