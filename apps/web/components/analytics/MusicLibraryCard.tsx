'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { auth, freshIdToken } from '@/lib/firebase/client'
import { uploadDraftMedia } from '@/lib/firebase/storage'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Track { id: string; name: string; url: string }

// 粉專免版稅音樂曲庫（管理端，與品牌素材庫同頁）。上傳/命名/試聽/移除在這裡；
// AI 草稿編輯器只從曲庫「選用」（components/content/MusicLibrary.tsx）。
// Meta 官方曲庫不開放 API（版權限制），曲目一律自備免版稅音樂。
export function MusicLibraryCard({ pageId, idToken }: { pageId: string; idToken: string }) {
  const { L } = useLang()
  const [tracks, setTracks] = useState<Track[]>([])
  const [canDraft, setCanDraft] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [name, setName] = useState('')
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const H = useCallback(async () => ({ Authorization: `Bearer ${(await freshIdToken()) || idToken}`, 'Content-Type': 'application/json' }), [idToken])

  const load = useCallback(async () => {
    const res = await fetch(`/api/content-drafts/music?pageId=${pageId}`, { headers: await H() })
    if (res.ok) setTracks((await res.json()).tracks ?? [])
  }, [pageId, H])

  useEffect(() => { if (pageId && idToken) load() }, [pageId, idToken, load])

  useEffect(() => {
    let alive = true
    setCanDraft(false); setCanDelete(false)
    if (!pageId || !idToken) return
    H().then(h => fetch(`/api/user/role?pageId=${pageId}`, { headers: h }))
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!alive) return
        const caps: string[] = Array.isArray(d?.capabilities) ? d.capabilities : []
        setCanDraft(caps.includes('content.draft'))
        setCanDelete(caps.includes('content.publish'))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [pageId, idToken, H])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    const uid = auth.currentUser?.uid
    if (!file || !uid) { setMsg({ kind: 'err', text: L('請先選一個音檔', 'Please select an audio file first') }); return }
    if (file.size > 20 * 1024 * 1024) { setMsg({ kind: 'err', text: L('音檔請小於 20MB', 'Audio must be under 20MB') }); return }
    setUploading(true); setMsg(null)
    try {
      const url = await uploadDraftMedia(uid, file)
      const res = await fetch('/api/content-drafts/music', {
        method: 'POST', headers: await H(),
        body: JSON.stringify({ pageId, name: name.trim() || file.name.replace(/\.[^.]+$/, ''), url }),
      })
      if (!res.ok) { setMsg({ kind: 'err', text: (await res.json()).error ?? L('儲存失敗', 'Save failed') }); return }
      setName(''); setFileName(''); if (fileRef.current) fileRef.current.value = ''
      setMsg({ kind: 'ok', text: L('✅ 已加入曲庫，AI 草稿編輯時可直接選用。', '✅ Added — pick it when composing a draft.') })
      await load()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : L('上傳失敗', 'Upload failed') })
    } finally { setUploading(false) }
  }

  async function remove(id: string) {
    if (!window.confirm(L('從曲庫移除這首音樂？（已合成的草稿不受影響）', 'Remove this track? Composed drafts are unaffected.'))) return
    await fetch('/api/content-drafts/music', { method: 'DELETE', headers: await H(), body: JSON.stringify({ pageId, id }) })
    await load()
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: 'white', marginTop: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🎵 {L('音樂曲庫', 'Music Library')}</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, lineHeight: 1.7 }}>
        {L('存粉專常用的背景音樂，AI 草稿編輯時可直接從曲庫選用（單圖會轉成 12 秒短影片、影片會取代原聲）。', 'Store background music once; pick a track while composing drafts (images become 12s videos, videos get their audio replaced).')}<br />
        <b>{L('僅限免版稅或自有音樂', 'Royalty-free or owned music only')}</b>{L(' —— 版權歌曲會被 Meta 偵測並靜音或限流。', ' — copyrighted tracks get muted or throttled by Meta.')}
      </p>

      {canDraft && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" style={{ display: 'none' }}
            onChange={e => setFileName(e.target.files?.[0]?.name ?? '')} />
          <button type="button" onClick={() => fileRef.current?.click()}
            style={{ padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {L('選擇音檔', 'Choose audio')}
          </button>
          <span style={{ fontSize: 12, color: '#9ca3af', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName || L('未選擇任何檔案', 'No file chosen')}
          </span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={L('曲名（留空用檔名）', 'Track name (blank = file name)')}
            style={{ flex: 1, minWidth: 140, fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
          <button onClick={upload} disabled={uploading}
            style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: uploading ? '#9ca3af' : '#2563eb', color: 'white', cursor: 'pointer' }}>
            {uploading ? L('⋯ 上傳中', '⋯ Uploading') : L('新增', 'Add')}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.kind === 'ok' ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      {tracks.length === 0
        ? <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>{L('曲庫還是空的。', 'No tracks yet.')}</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {tracks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <audio src={t.url} controls preload="none" style={{ height: 32, maxWidth: 260 }} />
                {canDelete && (
                  <button onClick={() => remove(t.id)}
                    style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>🗑</button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
