'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { uploadImageForCanva } from '@/lib/firebase/storage'

interface Asset { id: string; name: string; keyword?: string; url: string; mimeType?: string }

// Per-page brand asset library (logo etc.). Upload + tag with a keyword; each
// asset can be pushed into the user's Canva uploads to overlay on a design.
export function BrandAssetsCard({ pageId, idToken }: { pageId: string; idToken: string }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
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
    if (!file || !uid) { setMsg({ kind: 'err', text: '請先選一張圖片' }); return }
    setUploading(true); setMsg(null)
    try {
      const url = await uploadImageForCanva(uid, file)
      const res = await fetch('/api/brand-assets', {
        method: 'POST', headers: H(),
        body: JSON.stringify({ pageId, name: name.trim() || file.name, keyword: keyword.trim(), url, mimeType: file.type }),
      })
      if (!res.ok) { setMsg({ kind: 'err', text: (await res.json()).error ?? '儲存失敗' }); return }
      setName(''); setKeyword(''); if (fileRef.current) fileRef.current.value = ''
      setMsg({ kind: 'ok', text: '✅ 已加入品牌素材庫' })
      await load()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '上傳失敗' })
    } finally { setUploading(false) }
  }

  async function toCanva(a: Asset) {
    setBusy(a.id); setMsg(null)
    try {
      const res = await fetch('/api/canva/upload-asset', { method: 'POST', headers: H(), body: JSON.stringify({ url: a.url, name: a.name }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: d.error === 'CANVA_NOT_CONNECTED' ? 'Canva 未連接，請先連 Canva' : '帶進 Canva 失敗' }); return }
      setMsg({ kind: 'ok', text: `✅「${a.name}」已帶進 Canva uploads，到 Canva 把它拖到設計上即可。` })
    } finally { setBusy(null) }
  }

  async function remove(id: string) {
    await fetch('/api/brand-assets', { method: 'DELETE', headers: H(), body: JSON.stringify({ pageId, id }) })
    await load()
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: 'white' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🏷️ 品牌素材庫</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, lineHeight: 1.7 }}>存 logo 等品牌素材並標<b>關鍵字</b>。兩種用法：<br />
        ① <b>自動疊：</b>生圖時 prompt 提到該關鍵字（例「…加上 <b>logo</b>」），系統會自動把這個素材疊到圖右下角（像素級正確，不靠 AI 生）。<br />
        ② <b>帶進 Canva：</b>按下方按鈕把素材丟進 Canva uploads，自己拖到設計上。</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ fontSize: 12 }} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="名稱（如 Legacy TMC logo）"
          style={{ flex: 1, minWidth: 140, fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="關鍵字（如 logo）"
          style={{ width: 120, fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
        <button onClick={upload} disabled={uploading}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: uploading ? '#9ca3af' : '#2563eb', color: 'white', cursor: 'pointer' }}>
          {uploading ? '⋯ 上傳中' : '新增'}
        </button>
      </div>

      {msg && (
        <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.kind === 'ok' ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      {assets.length === 0
        ? <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>尚無素材。</p>
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
                    {busy === a.id ? '⋯' : '帶進 Canva'}
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
