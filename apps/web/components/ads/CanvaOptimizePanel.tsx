'use client'
import React, { useRef, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { uploadImageForCanva } from '@/lib/firebase/storage'

interface Props {
  open: boolean
  onClose: () => void
  pageId?: string
  onSendToChat: (message: string, imageBase64?: { data: string; mimeType: string; name: string }) => void
}

type Step = 'pick' | 'uploading' | 'fetching' | 'done' | 'error'
type Mode = 'upload' | 'canva'

function parseDesignId(url: string): string | null {
  const m = url.match(/canva\.com\/design\/(D[A-Za-z0-9_-]{10,})/i)
  return m?.[1] ?? null
}

export function CanvaOptimizePanel({ open, onClose, onSendToChat }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [mode, setMode] = useState<Mode | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [canvaUrl, setCanvaUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [assetId, setAssetId] = useState<string | null>(null)
  const [designEditUrl, setDesignEditUrl] = useState<string | null>(null)

  function reset() {
    setStep('pick')
    setMode(null)
    setUploadPct(0)
    setCanvaUrl('')
    setErrorMsg('')
    setAssetId(null)
    setDesignEditUrl(null)
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('僅支援 JPG / PNG 圖片')
      setStep('error')
      return
    }
    setMode('upload')
    setStep('uploading')

    try {
      const user = auth.currentUser
      if (!user) throw new Error('未登入')
      const idToken = await user.getIdToken()

      // 1. Upload to Firebase Storage
      const storageUrl = await uploadImageForCanva(user.uid, file, pct => setUploadPct(Math.round(pct)))

      // 2. Read as base64 for AI analysis
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // 3. Upload to Canva in background (non-blocking)
      fetch('/api/canva/upload-asset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: storageUrl, name: file.name }),
      }).then(async r => {
        if (r.ok) {
          const d = await r.json()
          if (d.assetId) setAssetId(d.assetId)
        }
      }).catch(() => {})

      // 4. Send image to Sidekick chat for AI analysis
      onSendToChat(
        `請分析這張廣告素材圖片，根據我的廣告數據給我具體的優化建議。包括：\n1. 視覺設計方向（配色、版面、圖片風格）\n2. 文案改善（標題、CTA、訴求角度）\n3. 針對我目前廣告目標的優先建議`,
        { data: base64, mimeType: file.type, name: file.name },
      )
      setStep('done')
      setDesignEditUrl('https://www.canva.com/')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '上傳失敗，請稍後再試')
      setStep('error')
    }
  }

  async function handleCanvaLink() {
    const designId = parseDesignId(canvaUrl.trim())
    if (!designId) {
      setErrorMsg('無法解析 Design ID，請確認連結格式為 canva.com/design/D.../...')
      setStep('error')
      return
    }

    setMode('canva')
    setStep('fetching')

    try {
      const user = auth.currentUser
      if (!user) throw new Error('未登入')
      const idToken = await user.getIdToken()

      const res = await fetch(`/api/canva/design/${designId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d.error === 'CANVA_NOT_CONNECTED') {
          setErrorMsg('尚未連接 Canva，請先至設定頁授權')
        } else {
          setErrorMsg('無法讀取設計稿，請確認連結是否正確')
        }
        setStep('error')
        return
      }

      const { title, textContent, editUrl } = await res.json()
      setDesignEditUrl(editUrl)

      const textSummary = textContent.length > 0
        ? `設計稿中的文字內容：\n${textContent.map((t: string) => `• ${t}`).join('\n')}`
        : '（設計稿中未偵測到文字層）'

      onSendToChat(
        `請分析我的 Canva 廣告設計稿「${title || designId}」，並根據我的廣告數據給我具體的優化建議。\n\n${textSummary}\n\n請針對以下項目給建議：\n1. 主標題 / 副標題改寫方向\n2. CTA 文案優化\n3. 整體訴求角度調整`,
      )
      setStep('done')
    } catch {
      setErrorMsg('讀取設計稿失敗，請稍後再試')
      setStep('error')
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'var(--ad-bg)',
      display: 'flex', flexDirection: 'column',
      borderRadius: 'inherit',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--ad-border)' }}>
        {step !== 'pick' && (
          <button onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 16, padding: '0 4px' }}>←</button>
        )}
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ad-text)', flex: 1 }}>✨ 優化廣告素材</span>
        <button onClick={() => { reset(); onClose() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px', gap: 16 }}>

        {/* Step: pick */}
        {step === 'pick' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', textAlign: 'center', marginBottom: 8 }}>
              你想怎麼提供廣告素材？
            </p>

            {/* Upload card */}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '16px', borderRadius: 12,
                border: '1.5px dashed var(--ad-border)', background: 'var(--ad-surface)',
                cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ad-blue)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--ad-border)')}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 3 }}>上傳圖片</div>
              <div style={{ fontSize: 12, color: 'var(--ad-text3)' }}>支援 JPG、PNG</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
            />

            {/* Canva link card */}
            <div style={{ borderRadius: 12, border: '1.5px solid var(--ad-border)', background: 'var(--ad-surface)', padding: 16 }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🔗</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 3 }}>貼上 Canva 連結</div>
              <div style={{ fontSize: 12, color: 'var(--ad-text3)', marginBottom: 10 }}>直接分析現有 Canva 設計稿</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={canvaUrl}
                  onChange={e => setCanvaUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && canvaUrl.trim()) handleCanvaLink() }}
                  placeholder="https://www.canva.com/design/D..."
                  style={{
                    flex: 1, fontSize: 12, padding: '7px 10px',
                    border: '1px solid var(--ad-border)', borderRadius: 8,
                    background: 'var(--ad-bg)', color: 'var(--ad-text)',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleCanvaLink}
                  disabled={!canvaUrl.trim()}
                  style={{
                    padding: '7px 12px', borderRadius: 8, border: 'none',
                    background: 'var(--ad-blue)', color: 'white',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    opacity: canvaUrl.trim() ? 1 : 0.4,
                  }}
                >
                  分析
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step: uploading */}
        {step === 'uploading' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>☁️</div>
            <p style={{ fontSize: 14, color: 'var(--ad-text)', marginBottom: 12 }}>上傳圖片中⋯</p>
            <div style={{ height: 4, background: 'var(--ad-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--ad-blue)', transition: 'width 0.3s', borderRadius: 2 }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--ad-text3)', marginTop: 8 }}>{uploadPct}%</p>
          </div>
        )}

        {/* Step: fetching */}
        {step === 'fetching' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <p style={{ fontSize: 14, color: 'var(--ad-text)' }}>讀取設計稿內容⋯</p>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 6 }}>已送出分析請求</p>
            <p style={{ fontSize: 12, color: 'var(--ad-text2)', marginBottom: 20 }}>
              {mode === 'upload' ? 'AI 正在分析你的廣告圖片，建議將顯示在對話框中。' : 'AI 正在分析你的設計稿文案，建議將顯示在對話框中。'}
            </p>
            {designEditUrl && (
              <a
                href={mode === 'canva' ? designEditUrl : 'https://www.canva.com/'}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', padding: '9px 18px', borderRadius: 10,
                  background: '#8B5CF6', color: 'white',
                  fontSize: 13, fontWeight: 600, textDecoration: 'none',
                }}
              >
                {mode === 'canva' ? '在 Canva 中編輯 →' : '前往 Canva 使用素材 →'}
              </a>
            )}
            {mode === 'upload' && assetId && (
              <p style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 8 }}>
                素材已同步至 Canva 資產庫（ID: {assetId}）
              </p>
            )}
            <button
              onClick={() => { reset(); onClose() }}
              style={{ display: 'block', width: '100%', marginTop: 16, padding: '8px', borderRadius: 8, border: '1px solid var(--ad-border)', background: 'none', color: 'var(--ad-text2)', fontSize: 13, cursor: 'pointer' }}
            >
              關閉
            </button>
          </div>
        )}

        {/* Step: error */}
        {step === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 16 }}>{errorMsg}</p>
            <button
              onClick={reset}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--ad-border)', background: 'none', color: 'var(--ad-text)', fontSize: 13, cursor: 'pointer' }}
            >
              重試
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
