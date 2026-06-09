'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { uploadImageForCanva } from '@/lib/firebase/storage'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Asset { id: string; name: string; keyword?: string; url: string; mimeType?: string }

// Per-page brand asset library (logo etc.). Upload + tag with a keyword; each
// asset can be pushed into the user's Canva uploads to overlay on a design.
export function BrandAssetsCard({ pageId, idToken }: { pageId: string; idToken: string }) {
  const { L } = useLang()
  const [assets, setAssets] = useState<Asset[]>([])
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const H = useCallback(() => ({ Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }), [idToken])

  const load = useCallback(async () => {
    const res = await fetch(`/api/brand-assets?pageId=${pageId}`, { headers: H() })
    if (res.ok) setAssets((await res.json()).assets ?? [])
  }, [pageId, H])

  useEffect(() => { if (pageId && idToken) load() }, [pageId, idToken, load])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    const uid = auth.currentUser?.uid
    if (!file || !uid) { setMsg({ kind: 'err', text: L('請先選一張圖片', 'Please select an image first') }); return }
    setUploading(true); setMsg(null)
    try {
      const url = await uploadImageForCanva(uid, file)
      const res = await fetch('/api/brand-assets', {
        method: 'POST', headers: H(),
        body: JSON.stringify({ pageId, name: name.trim() || file.name, keyword: keyword.trim(), url, mimeType: file.type }),
      })
      if (!res.ok) { setMsg({ kind: 'err', text: (await res.json()).error ?? L('儲存失敗', 'Save failed') }); return }
      setName(''); setKeyword(''); setFileName(''); if (fileRef.current) fileRef.current.value = ''
      setMsg({ kind: 'ok', text: L('✅ 已加入品牌素材庫', '✅ Added to brand asset library') })
      await load()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : L('上傳失敗', 'Upload failed') })
    } finally { setUploading(false) }
  }

  async function toCanva(a: Asset) {
    setBusy(a.id); setMsg(null)
    try {
      const res = await fetch('/api/canva/upload-asset', { method: 'POST', headers: H(), body: JSON.stringify({ url: a.url, name: a.name }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: d.error === 'CANVA_NOT_CONNECTED' ? L('Canva 未連接，請先連 Canva', 'Canva not connected — connect Canva first') : L('帶進 Canva 失敗', 'Failed to send to Canva') }); return }
      setMsg({ kind: 'ok', text: L(`✅「${a.name}」已帶進 Canva uploads，到 Canva 把它拖到設計上即可。`, `✅ "${a.name}" added to Canva uploads — drag it onto your design in Canva.`) })
    } finally { setBusy(null) }
  }

  async function remove(id: string) {
    await fetch('/api/brand-assets', { method: 'DELETE', headers: H(), body: JSON.stringify({ pageId, id }) })
    await load()
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: 'white' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🏷️ {L('品牌素材庫', 'Brand Asset Library')}</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, lineHeight: 1.7 }}>{L('存 logo 等品牌素材並標', 'Store brand assets like your logo and tag them with a ')}<b>{L('關鍵字', 'keyword')}</b>{L('。兩種用法：', '. Two ways to use:')}<br />
        {L('① ', '① ')}<b>{L('自動疊：', 'Auto-overlay: ')}</b>{L('生圖時 prompt 提到該關鍵字（例「…加上 ', 'when a generation prompt mentions the keyword (e.g. "…add the ')}<b>logo</b>{L('」），系統會自動把這個素材疊到圖右下角（像素級正確，不靠 AI 生）。', '"), the system overlays this asset onto the bottom-right of the image (pixel-perfect, not AI-generated).')}<br />
        {L('② ', '② ')}<b>{L('帶進 Canva：', 'Send to Canva: ')}</b>{L('按下方按鈕把素材丟進 Canva uploads，自己拖到設計上。', 'click the button below to push the asset into Canva uploads, then drag it onto your design.')}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => setFileName(e.target.files?.[0]?.name ?? '')} />
        <button type="button" onClick={() => fileRef.current?.click()}
          style={{ padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {L('選擇檔案', 'Choose file')}
        </button>
        <span style={{ fontSize: 12, color: '#9ca3af', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName || L('未選擇任何檔案', 'No file chosen')}
        </span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={L('名稱（如 Legacy TMC logo）', 'Name (e.g. Legacy TMC logo)')}
          style={{ flex: 1, minWidth: 140, fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={L('關鍵字（如 logo）', 'Keyword (e.g. logo)')}
          style={{ width: 120, fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
        <button onClick={upload} disabled={uploading}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: uploading ? '#9ca3af' : '#2563eb', color: 'white', cursor: 'pointer' }}>
          {uploading ? L('⋯ 上傳中', '⋯ Uploading') : L('新增', 'Add')}
        </button>
      </div>

      {msg && (
        <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.kind === 'ok' ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      {assets.length === 0
        ? <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>{L('尚無素材。', 'No assets yet.')}</p>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
            {assets.map(a => (
              <div key={a.id} style={{ width: 150, border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.name} style={{ width: '100%', height: 90, objectFit: 'contain', background: '#f8fafc', borderRadius: 4 }} />
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                {a.keyword && <div style={{ fontSize: 11, color: '#9ca3af' }}>#{a.keyword}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={() => toCanva(a)} disabled={busy === a.id}
                    style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>
                    {busy === a.id ? '⋯' : L('帶進 Canva', 'Send to Canva')}
                  </button>
                  <button onClick={() => remove(a.id)}
                    style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
