'use client'

import { useRef, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Props {
  pageId: string
  onImported: () => void
}

function parseCSV(text: string): Record<string, string>[] {
  const cleaned = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = cleaned.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        result.push(cur.trim().replace(/^"|"$/g, ''))
        cur = ''
      } else {
        cur += ch
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, ''))
    return result
  }

  const headers = parseLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  }).filter(row => Object.values(row).some(v => v))
}

type Status = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

export function FbCsvImport({ pageId, onImported }: Props) {
  const { L } = useLang()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<{ updated: number; skipped: number } | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    setFileName(file.name)
    setStatus('parsing')
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.length) { setError(L('CSV 無法解析，請確認格式', "Can't parse CSV — please check the format")); setStatus('error'); return }
      setRows(parsed)
      setStatus('preview')
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function handleImport() {
    setStatus('importing')
    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      const res = await fetch('/api/fb/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ rows, pageId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? L('匯入失敗', 'Import failed')); setStatus('error'); return }
      setResult({ updated: data.updated, skipped: data.skipped })
      setStatus('done')
      onImported()
    } catch {
      setError(L('網路錯誤，請重試', 'Network error, please retry'))
      setStatus('error')
    }
  }

  function reset() { setStatus('idle'); setRows([]); setFileName(''); setResult(null); setError('') }

  const previewHeaders = rows[0] ? Object.keys(rows[0]).slice(0, 6) : []
  const previewRows = rows.slice(0, 3)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          border: '1px solid var(--ad-border)', background: 'var(--ad-surface)',
          color: 'var(--ad-text2)', display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        ⬆️ {L('匯入 FB CSV', 'Import FB CSV')}
      </button>

      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); reset() } }}
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 640,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{L('匯入 Facebook Insights CSV', 'Import Facebook Insights CSV')}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {L('從 Meta Business Suite → Insights → 貼文 → 匯出數據', 'From Meta Business Suite → Insights → Posts → Export data')}
                </div>
              </div>
              <button onClick={() => { setOpen(false); reset() }} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
            </div>

            {(status === 'idle' || status === 'parsing') && (
              <div
                style={{
                  border: '2px dashed #d1d5db', borderRadius: 12, padding: '40px 20px',
                  textAlign: 'center', cursor: 'pointer', background: '#fafafa',
                }}
                onClick={() => inputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {status === 'parsing' ? L('解析中…', 'Parsing…') : L('點擊選擇或拖曳 CSV 檔案', 'Click to choose or drag a CSV file')}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{L('支援 UTF-8 編碼的 CSV', 'Supports UTF-8 encoded CSV')}</div>
                <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </div>
            )}

            {status === 'preview' && (
              <>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                  {L('檔案：', 'File: ')}<strong>{fileName}</strong>{L('｜共 ', ' · ')}<strong>{rows.length}</strong>{L(' 筆', ' rows')}
                </div>
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 16 }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        {previewHeaders.map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', color: '#374151', fontWeight: 600 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          {previewHeaders.map(h => (
                            <td key={h} style={{ padding: '5px 10px', color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row[h] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={reset} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151' }}>
                    {L('重選檔案', 'Choose another')}
                  </button>
                  <button onClick={handleImport} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {L('開始匯入', 'Start import')}
                  </button>
                </div>
              </>
            )}

            {status === 'importing' && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280', fontSize: 13 }}>
                {L('匯入中，請稍候…', 'Importing, please wait…')}
              </div>
            )}

            {status === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{L('匯入完成', 'Import complete')}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                  {L('更新 ', 'Updated ')}<strong>{result.updated}</strong>{L(' 筆，略過 ', ', skipped ')}<strong>{result.skipped}</strong>{L(' 筆（無法解析 ID）', " (couldn't parse ID)")}
                </div>
                <button onClick={() => { setOpen(false); reset() }} style={{ marginTop: 20, padding: '8px 24px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {L('關閉', 'Close')}
                </button>
              </div>
            )}

            {status === 'error' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626' }}>{error}</div>
                <button onClick={reset} style={{ marginTop: 16, padding: '7px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>
                  {L('重試', 'Retry')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
