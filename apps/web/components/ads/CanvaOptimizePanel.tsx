'use client'
import React, { useRef, useState, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'
import { uploadImageForCanva } from '@/lib/firebase/storage'
import { fireCreativeSignal } from '@/lib/ai/creativeSignalClient'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Props {
  open: boolean
  onClose: () => void
  pageId?: string
  onSendToChat: (message: string, imageBase64?: { data: string; mimeType: string; name: string }) => void
}

type Step = 'pick' | 'uploading' | 'fetching' | 'generateInput' | 'generating' | 'done' | 'genResult' | 'error'
type Mode = 'upload' | 'canva' | 'generate'

interface GeneratedCreative {
  imageData: string
  mimeType: string
  imageDataBaked?: string | null   // English mode: text baked into the image
  bakedMimeType?: string | null
  headline: string
  subhead: string
  cta: string
  rationale: string
}

type PanelEngine = 'fal-grok-image' | 'fal-gpt-image-2' | 'fal-recraft' | 'fal-flux'

const ENGINE_OPTIONS: { value: PanelEngine; zh: string; en: string }[] = [
  { value: 'fal-grok-image', zh: 'Grok Imagine（預設・便宜美感）', en: 'Grok Imagine (default · cheap & pretty)' },
  { value: 'fal-gpt-image-2', zh: 'GPT Image 2（文字最強・含中文）', en: 'GPT Image 2 (best text · incl. Chinese)' },
  { value: 'fal-recraft', zh: 'Recraft V3（廣告/品牌風格）', en: 'Recraft V3 (ad / brand style)' },
  { value: 'fal-flux', zh: 'FLUX dev（快速通用）', en: 'FLUX dev (fast & general)' },
]

function parseDesignId(url: string): string | null {
  const m = url.match(/canva\.com\/design\/(D[A-Za-z0-9_-]{10,})/i)
  return m?.[1] ?? null
}

// One row of suggested copy with a copy-to-clipboard button. Chinese copy is
// kept as text (not baked into the AI image) so it can be pasted into Canva.
function CopyRow({ label, value }: { label: string; value: string }) {
  const { L } = useLang()
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ color: 'var(--ad-text3)', minWidth: 44 }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--ad-text)', fontWeight: 500 }}>{value}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        style={{ background: 'none', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--ad-blue)', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        {copied ? L('已複製', 'Copied') : L('複製', 'Copy')}
      </button>
    </div>
  )
}

export function CanvaOptimizePanel({ open, onClose, pageId, onSendToChat }: Props) {
  const { L, lang } = useLang()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [mode, setMode] = useState<Mode | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [canvaUrl, setCanvaUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [assetId, setAssetId] = useState<string | null>(null)
  const [designEditUrl, setDesignEditUrl] = useState<string | null>(null)
  const [briefText, setBriefText] = useState('')
  const [engine, setEngine] = useState<PanelEngine>('fal-grok-image')
  const [gen, setGen] = useState<GeneratedCreative | null>(null)
  // Which creative variant to show: 'baked' = text in image, 'clean' = base + overlay copy.
  const [variant, setVariant] = useState<'baked' | 'clean'>('baked')
  const [pushing, setPushing] = useState(false)
  const [pushedUrl, setPushedUrl] = useState<string | null>(null)
  const [pushError, setPushError] = useState('')
  // null = checking, true/false = known
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null)

  // Check Canva connection status whenever panel opens
  useEffect(() => {
    if (!open) return
    setCanvaConnected(null)
    auth.currentUser?.getIdToken().then(async idToken => {
      try {
        const res = await fetch('/api/canva/status', { headers: { Authorization: `Bearer ${idToken}` } })
        const d = await res.json()
        setCanvaConnected(!!d.connected)
      } catch {
        setCanvaConnected(false)
      }
    })
  }, [open])

  function reset() {
    setStep('pick')
    setMode(null)
    setUploadPct(0)
    setCanvaUrl('')
    setErrorMsg('')
    setAssetId(null)
    setDesignEditUrl(null)
    setBriefText('')
    setEngine('fal-grok-image')
    setGen(null)
    setPushing(false)
    setPushedUrl(null)
    setPushError('')
  }

  // The image to act on (display / push / download), per the selected variant.
  const activeImg = (g: GeneratedCreative) =>
    variant === 'baked' && g.imageDataBaked
      ? { data: g.imageDataBaked, mime: g.bakedMimeType ?? 'image/png' }
      : { data: g.imageData, mime: g.mimeType }

  // Push the generated image into Canva as a new design (asset → design).
  async function pushToCanva() {
    if (!gen) return
    setPushing(true)
    setPushError('')
    try {
      const user = auth.currentUser
      if (!user) throw new Error(L('未登入', 'Not logged in'))
      const idToken = await user.getIdToken()
      const res = await fetch('/api/canva/create-design', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: activeImg(gen).data, mimeType: activeImg(gen).mime, title: gen.headline || L('ContentLoop AI 設計', 'ContentLoop AI design') }),
      })
      const d = await res.json()
      if (!res.ok || !d.editUrl) {
        setPushError(d.error === 'CANVA_NOT_CONNECTED' ? L('Canva 授權已失效，請到設定頁重新連接。', 'Canva authorization expired. Please reconnect in Settings.') : L('推送失敗，請稍後再試。', 'Push failed, please try again later.'))
        return
      }
      setPushedUrl(d.editUrl)
      fireCreativeSignal(pageId, briefText.trim() || gen.headline || '', 'canva_import')
    } catch {
      setPushError(L('推送失敗，請稍後再試。', 'Push failed, please try again later.'))
    } finally {
      setPushing(false)
    }
  }

  async function handleGenerate() {
    setMode('generate')
    setStep('generating')
    try {
      const user = auth.currentUser
      if (!user) throw new Error(L('未登入', 'Not logged in'))
      const idToken = await user.getIdToken()
      const res = await fetch('/api/ai/creative', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, brief: briefText.trim() || undefined, engine, language: lang }),
      })
      // Slow models can hit the function timeout → Vercel returns a plain-text
      // error (not JSON). Parse defensively and show a friendly message.
      const raw = await res.text()
      let d: { imageData?: string; mimeType?: string; imageDataBaked?: string | null; bakedMimeType?: string | null; headline?: string; subhead?: string; cta?: string; rationale?: string; error?: string } = {}
      try { d = raw ? JSON.parse(raw) : {} } catch { /* non-JSON (timeout/crash) */ }
      if (!res.ok || !d.imageData) {
        const timedOut = res.status === 504 || /timeout|timed out|an error occurred/i.test(raw)
        setErrorMsg(
          d.error === 'NO_API_KEY' ? L('尚未設定 AI API 金鑰，請先到設定頁設定。', 'No AI API key set yet — please set it in Settings first.')
          : timedOut ? L('生成逾時了（GPT Image 2 較慢）。請改用 Grok 或 Recraft，或稍後重試。', 'Generation timed out (GPT Image 2 is slower). Try Grok or Recraft, or retry later.')
          : (d.error ?? L('生成失敗，請稍後再試', 'Generation failed, please try again later'))
        )
        setStep('error')
        return
      }
      setGen({
        imageData: d.imageData, mimeType: d.mimeType ?? 'image/png',
        imageDataBaked: d.imageDataBaked ?? null, bakedMimeType: d.bakedMimeType ?? null,
        headline: d.headline ?? '', subhead: d.subhead ?? '', cta: d.cta ?? '', rationale: d.rationale ?? '',
      })
      setVariant(d.imageDataBaked ? 'baked' : 'clean')
      setStep('genResult')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : L('生成失敗，請稍後再試', 'Generation failed, please try again later'))
      setStep('error')
    }
  }

  function downloadGenerated() {
    if (!gen) return
    const a = document.createElement('a')
    a.href = `data:${activeImg(gen).mime};base64,${activeImg(gen).data}`
    a.download = `contentloop-creative-${Date.now()}.png`
    a.click()
    fireCreativeSignal(pageId, briefText.trim() || gen.headline || '', 'download')
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setErrorMsg(L('僅支援 JPG / PNG 圖片', 'Only JPG / PNG images are supported'))
      setStep('error')
      return
    }
    setMode('upload')
    setStep('uploading')

    try {
      const user = auth.currentUser
      if (!user) throw new Error(L('未登入', 'Not logged in'))
      const idToken = await user.getIdToken()

      // 1. Upload to Firebase Storage (needed for Canva asset sync + persistent URL)
      const storageUrl = await uploadImageForCanva(user.uid, file, pct => setUploadPct(Math.round(pct)))

      // 2. Read as base64 for AI analysis (no Canva required)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // 3. If Canva connected, upload asset in background (non-blocking)
      if (canvaConnected) {
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
      }

      // 4. Send image to Sidekick chat for AI analysis
      onSendToChat(
        L('請分析這張廣告素材圖片，根據我的廣告數據給我具體的優化建議。包括：\n1. 視覺設計方向（配色、版面、圖片風格）\n2. 文案改善（標題、CTA、訴求角度）\n3. 針對我目前廣告目標的優先建議', 'Please analyze this ad creative image and give specific optimization suggestions based on my ad data, including:\n1. Visual direction (color, layout, image style)\n2. Copy improvements (headline, CTA, angle)\n3. Priority suggestions for my current ad objective'),
        { data: base64, mimeType: file.type, name: file.name },
      )
      setStep('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : L('上傳失敗，請稍後再試', 'Upload failed, please try again later'))
      setStep('error')
    }
  }

  async function handleCanvaLink() {
    setMode('canva')
    setStep('fetching')

    try {
      const user = auth.currentUser
      if (!user) throw new Error(L('未登入', 'Not logged in'))
      const idToken = await user.getIdToken()

      // Resolve the design ID. Full canva.com/design/D... links parse locally;
      // short canva.link/... links are expanded server-side (follow redirect).
      let designId = parseDesignId(canvaUrl.trim())
      if (!designId) {
        const r = await fetch('/api/canva/resolve-link', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: canvaUrl.trim() }),
        })
        const rd = await r.json().catch(() => ({}))
        if (r.ok && rd.designId) designId = rd.designId
      }
      if (!designId) {
        setErrorMsg(L('無法解析這個 Canva 連結，請改貼設計稿的完整網址（canva.com/design/...）', "Can't parse this Canva link — paste the full design URL (canva.com/design/...)"))
        setStep('error')
        return
      }

      const res = await fetch(`/api/canva/design/${designId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })

      if (!res.ok) {
        const ed = await res.json().catch(() => ({}))
        if (ed.error === 'CANVA_DESIGN_FORBIDDEN') {
          setErrorMsg(L('讀不到這份設計稿：它必須是「你連接的 Canva 帳號」自己擁有的設計。請貼自己帳號裡的設計連結。', "Can't read this design: it must be owned by your connected Canva account. Paste a design link from your own account."))
        } else if (ed.error === 'CANVA_NOT_CONNECTED') {
          setErrorMsg(L('Canva 授權已失效，請到設定頁重新連接 Canva。', 'Canva authorization expired. Please reconnect Canva in Settings.'))
        } else {
          setErrorMsg(L('無法讀取設計稿，請確認連結是否正確', "Can't read the design — please check the link is correct"))
        }
        setStep('error')
        return
      }

      const { title, thumbnail, editUrl } = await res.json() as {
        title: string; editUrl: string; thumbnail: { data: string; mimeType: string } | null
      }
      setDesignEditUrl(editUrl)

      const prompt = L(`請分析我的 Canva 廣告設計稿「${title || designId}」，並根據我的廣告數據給我具體的優化建議。請針對：\n1. 視覺設計（配色、版面、圖片風格）\n2. 主標題 / 副標題 / CTA 文案改寫方向\n3. 整體訴求角度調整`, `Please analyze my Canva ad design "${title || designId}" and give specific optimization suggestions based on my ad data, covering:\n1. Visual design (color, layout, image style)\n2. Rewrite direction for headline / subhead / CTA\n3. Overall angle adjustments`)

      // Canva's API exposes only a page thumbnail (no text content), so we send
      // the thumbnail image to the AI for visual analysis (it reads the text itself).
      if (thumbnail?.data) {
        onSendToChat(prompt, { data: thumbnail.data, mimeType: thumbnail.mimeType, name: `${title || designId}.png` })
      } else {
        onSendToChat(`${prompt}\n\n${L('（這份設計稿讀不到縮圖，請直接描述內容或貼上主要文案，我再給建議。）', "(No thumbnail available for this design — describe its content or paste the main copy and I'll advise.)")}`)
      }
      setStep('done')
    } catch {
      setErrorMsg(L('讀取設計稿失敗，請稍後再試', 'Failed to read the design, please try again later'))
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
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ad-text)', flex: 1 }}>✨ {L('優化廣告素材', 'Optimize Creative')}</span>
        <button onClick={() => { reset(); onClose() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ad-text3)', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px', gap: 16 }}>

        {/* Step: pick */}
        {step === 'pick' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', textAlign: 'center', marginBottom: 8 }}>
              {L('你想怎麼提供廣告素材？', 'How do you want to provide the creative?')}
            </p>

            {/* Upload card — works without Canva */}
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
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 3 }}>{L('上傳圖片', 'Upload image')}</div>
              <div style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('支援 JPG、PNG　無需 Canva 帳號', 'JPG, PNG · no Canva account needed')}</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
            />

            {/* Canva link card — gated on Canva connection */}
            <div style={{ borderRadius: 12, border: '1.5px solid var(--ad-border)', background: 'var(--ad-surface)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 22 }}>🔗</div>
                {canvaConnected === true && (
                  <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>● {L('已連接', 'Connected')}</span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 3 }}>{L('貼上 Canva 連結', 'Paste Canva link')}</div>
              <div style={{ fontSize: 12, color: 'var(--ad-text3)', marginBottom: 10 }}>{L('直接分析現有 Canva 設計稿', 'Analyze an existing Canva design directly')}</div>

              {canvaConnected === null && (
                <p style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('檢查連線中⋯', 'Checking connection…')}</p>
              )}

              {canvaConnected === false && (
                <div style={{ padding: '10px 12px', background: '#fef9c3', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#854d0e' }}>{L('需先連接 Canva 帳號', 'Connect a Canva account first')}</span>
                  <a
                    href="/dashboard/settings"
                    style={{ fontSize: 12, fontWeight: 600, color: '#8B5CF6', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    {L('前往設定 →', 'Go to Settings →')}
                  </a>
                </div>
              )}

              {canvaConnected === true && (
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
                    {L('分析', 'Analyze')}
                  </button>
                </div>
              )}
            </div>

            {/* AI generate card — produces an optimized visual from scratch */}
            <button
              onClick={() => { setMode('generate'); setStep('generateInput') }}
              style={{
                width: '100%', padding: '16px', borderRadius: 12,
                border: '1.5px solid var(--ad-border)', background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,111,212,0.06))',
                cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#8B5CF6')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--ad-border)')}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>✨</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 3 }}>{L('AI 生成優化視覺', 'AI-generate optimized visual')}</div>
              <div style={{ fontSize: 12, color: 'var(--ad-text3)' }}>{L('依品牌資料產出全新廣告底圖 + 建議文案', 'Generate a fresh ad base + suggested copy from your brand data')}</div>
            </button>
          </>
        )}

        {/* Step: generate input */}
        {step === 'generateInput' && (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ad-text3)', marginBottom: 6 }}>{L('圖片模型', 'Image model')}</label>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value as PanelEngine)}
              style={{
                width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 10, marginBottom: 14,
                border: '1px solid var(--ad-border)', background: 'var(--ad-bg)', color: 'var(--ad-text)',
                outline: 'none', cursor: 'pointer',
              }}
            >
              {ENGINE_OPTIONS.map(o => <option key={o.value} value={o.value}>{L(o.zh, o.en)}</option>)}
            </select>
            <p style={{ fontSize: 13, color: 'var(--ad-text2)', marginBottom: 10 }}>
              {L('想強調什麼？（選填，留空則依品牌資料自動發想）', 'What to emphasize? (optional; leave blank to auto-ideate from brand data)')}
            </p>
            <textarea
              value={briefText}
              onChange={e => setBriefText(e.target.value)}
              placeholder={L('例如：主打 6/6 台北演講節早鳥報名，氛圍要熱血、專業', 'e.g. Push 6/6 Taipei Speech Festival early-bird sign-up; energetic, professional mood')}
              rows={4}
              style={{
                width: '100%', fontSize: 13, padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--ad-border)', background: 'var(--ad-bg)', color: 'var(--ad-text)',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <p style={{ fontSize: 11, color: 'var(--ad-text3)', margin: '8px 0 14px' }}>
              {L('⚠️ AI 圖片無法正確顯示中文，底圖只放視覺與英文字；中文標題會另外列出，之後可貼到 Canva 當文字。', '⚠️ AI images render Chinese poorly, so the base image only carries visuals and English text; the headline is listed separately to paste into Canva as text.')}
            </p>
            <button
              onClick={handleGenerate}
              style={{
                width: '100%', padding: '11px', borderRadius: 10, border: 'none',
                background: '#8B5CF6', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ✨ {L('生成優化視覺', 'Generate optimized visual')}
            </button>
          </div>
        )}

        {/* Step: generating */}
        {step === 'generating' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
            <p style={{ fontSize: 14, color: 'var(--ad-text)' }}>{L('AI 生成中⋯', 'AI generating…')}</p>
            <p style={{ fontSize: 12, color: 'var(--ad-text3)', marginTop: 6 }}>{L('產出創意文案並繪製視覺，約需 10–20 秒', 'Writing copy and drawing the visual — about 10–20 sec')}</p>
          </div>
        )}

        {/* Step: generate result */}
        {step === 'genResult' && gen && (
          <div>
            {/* Variant toggle — only when a baked-text English variant exists. */}
            {gen.imageDataBaked && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {([['baked', L('圖內含文字', 'Text in image')], ['clean', L('純底圖＋疊字', 'Clean + overlay')]] as const).map(([v, lbl]) => (
                  <button key={v} onClick={() => setVariant(v)}
                    style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${variant === v ? '#8B5CF6' : 'var(--ad-border)'}`,
                      background: variant === v ? '#f5f3ff' : 'var(--ad-bg)', color: variant === v ? '#6d28d9' : 'var(--ad-text2)' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${activeImg(gen).mime};base64,${activeImg(gen).data}`}
              alt={L('AI 生成廣告視覺', 'AI-generated ad visual')}
              style={{ width: '100%', borderRadius: 12, marginBottom: 14, display: 'block' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {gen.headline && <CopyRow label={L('主標題', 'Headline')} value={gen.headline} />}
              {gen.subhead && <CopyRow label={L('副標題', 'Subhead')} value={gen.subhead} />}
              {gen.cta && <CopyRow label="CTA" value={gen.cta} />}
            </div>
            {gen.rationale && (
              <p style={{ fontSize: 12, color: 'var(--ad-text2)', background: 'var(--ad-surface)', padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
                💡 {gen.rationale}
              </p>
            )}
            {/* Push to Canva — creates a new design containing this image */}
            {canvaConnected && !pushedUrl && (
              <button
                onClick={pushToCanva}
                disabled={pushing}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#00C4CC', color: 'white', fontSize: 13, fontWeight: 600, cursor: pushing ? 'default' : 'pointer', marginBottom: 8, opacity: pushing ? 0.7 : 1 }}
              >
                {pushing ? L('推送到 Canva 中⋯（約 10–20 秒）', 'Pushing to Canva… (about 10–20 sec)') : L('🎨 推到 Canva 建立設計稿', '🎨 Push to Canva as a design')}
              </button>
            )}
            {pushedUrl && (
              <a
                href={pushedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', textAlign: 'center', width: '100%', padding: '10px', borderRadius: 8, background: '#00C4CC', color: 'white', fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 8 }}
              >
                {L('✓ 已建立 — 在 Canva 開啟編輯 →', '✓ Created — open & edit in Canva →')}
              </a>
            )}
            {pushedUrl && (
              <p style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 8, textAlign: 'center' }}>
                {L('設計稿已含底圖；上方中文文案可複製後在 Canva 貼成可編輯文字。', 'The design already includes the base image; copy the text above and paste it into Canva as editable text.')}
              </p>
            )}
            {pushError && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{pushError}</p>}
            {canvaConnected === false && !pushedUrl && (
              <p style={{ fontSize: 11, color: 'var(--ad-text3)', marginBottom: 8, textAlign: 'center' }}>
                {L('連接 Canva 後可一鍵推成設計稿（目前僅可下載）。', 'Connect Canva to push as a design in one click (download only for now).')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={downloadGenerated}
                style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--ad-border)', background: 'none', color: 'var(--ad-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                ⬇ {L('下載底圖', 'Download base')}
              </button>
              <button
                onClick={() => { setGen(null); setPushedUrl(null); setPushError(''); setStep('generateInput') }}
                style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--ad-border)', background: 'none', color: 'var(--ad-text2)', fontSize: 13, cursor: 'pointer' }}
              >
                ↻ {L('重新生成', 'Regenerate')}
              </button>
            </div>
          </div>
        )}

        {/* Step: uploading */}
        {step === 'uploading' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>☁️</div>
            <p style={{ fontSize: 14, color: 'var(--ad-text)', marginBottom: 12 }}>{L('上傳圖片中⋯', 'Uploading image…')}</p>
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
            <p style={{ fontSize: 14, color: 'var(--ad-text)' }}>{L('讀取設計稿內容⋯', 'Reading design content…')}</p>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ad-text)', marginBottom: 6 }}>{L('已送出分析請求', 'Analysis request sent')}</p>
            <p style={{ fontSize: 12, color: 'var(--ad-text2)', marginBottom: 20 }}>
              {mode === 'upload' ? L('AI 正在分析你的廣告圖片，建議將顯示在對話框中。', 'AI is analyzing your ad image; suggestions will appear in the chat.') : L('AI 正在分析你的設計稿文案，建議將顯示在對話框中。', 'AI is analyzing your design copy; suggestions will appear in the chat.')}
            </p>
            {/* Canva deep link: only show if Canva connected (Method C always, Method A only if asset synced) */}
            {mode === 'canva' && designEditUrl && (
              <a
                href={designEditUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', padding: '9px 18px', borderRadius: 10,
                  background: '#8B5CF6', color: 'white',
                  fontSize: 13, fontWeight: 600, textDecoration: 'none',
                }}
              >
                {L('在 Canva 中編輯 →', 'Edit in Canva →')}
              </a>
            )}
            {mode === 'upload' && canvaConnected && assetId && (
              <>
                <a
                  href="https://www.canva.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block', padding: '9px 18px', borderRadius: 10,
                    background: '#8B5CF6', color: 'white',
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                  }}
                >
                  {L('前往 Canva 使用素材 →', 'Open Canva to use the asset →')}
                </a>
                <p style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 8 }}>
                  {L('素材已同步至 Canva 資產庫', 'Asset synced to your Canva library')}
                </p>
              </>
            )}
            <button
              onClick={() => { reset(); onClose() }}
              style={{ display: 'block', width: '100%', marginTop: 16, padding: '8px', borderRadius: 8, border: '1px solid var(--ad-border)', background: 'none', color: 'var(--ad-text2)', fontSize: 13, cursor: 'pointer' }}
            >
              {L('關閉', 'Close')}
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
              {L('重試', 'Retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
