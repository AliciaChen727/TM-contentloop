'use client'

import { useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { parseFbInsightsMarkdown, type ParseResult } from '@/lib/parsers/fbInsightsMarkdown'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Props {
  pageId: string
  onImported: () => void
}

type Status = 'idle' | 'preview' | 'importing' | 'done' | 'error'

export function FbMdImport({ pageId, onImported }: Props) {
  const { L } = useLang()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [markdown, setMarkdown] = useState('')
  const [preview, setPreview] = useState<ParseResult | null>(null)
  const [result, setResult] = useState<{
    pageInsightsSaved: boolean
    postReachUpdated: number
    postReachSkipped: number
    bizUpdated: number
    bizCreated: number
    bizSkipped: number
    warnings: string[]
  } | null>(null)
  const [error, setError] = useState('')

  function handleParse() {
    if (!markdown.trim()) return
    const parsed = parseFbInsightsMarkdown(markdown)
    setPreview(parsed)
    setStatus('preview')
  }

  async function handleImport() {
    setStatus('importing')
    try {
      const user = auth.currentUser
      const idToken = user ? await user.getIdToken() : null
      const res = await fetch('/api/fb/import-md-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ markdown, pageId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? L('匯入失敗', 'Import failed')); setStatus('error'); return }
      setResult(data)
      setStatus('done')
      onImported()
    } catch {
      setError(L('網路錯誤，請重試', 'Network error, please retry'))
      setStatus('error')
    }
  }

  function reset() {
    setStatus('idle')
    setMarkdown('')
    setPreview(null)
    setResult(null)
    setError('')
  }

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
        📋 {L('匯入 FB 洞察 Markdown', 'Import FB Insights Markdown')}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); reset() } }}
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 680,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{L('匯入 FB 洞察報告（Markdown）', 'Import FB Insights Report (Markdown)')}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.5 }}>
                  {L('用瀏覽器外掛把 FB 專業主控板「洞察報告」存成 Markdown，貼入下方。', 'Use a browser extension to save the FB Professional Dashboard "Insights" as Markdown, then paste it below.')}<br />
                  {L('支援：粉絲頁整體指標 + 貼文觸及人數', 'Supports: Page-level metrics + per-post reach')}
                </div>
              </div>
              <button
                onClick={() => { setOpen(false); reset() }}
                style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#999', flexShrink: 0, marginLeft: 12 }}
              >
                ✕
              </button>
            </div>

            {status === 'idle' && (
              <>
                <textarea
                  value={markdown}
                  onChange={e => setMarkdown(e.target.value)}
                  placeholder={L('把 Markdown 貼到這裡…\n\n範例：\n瀏覽次數\n4,402\nReel\n55.9%\n非追蹤者\n63.2%', 'Paste Markdown here…\n\nExample:\nViews\n4,402\nReel\n55.9%\nNon-followers\n63.2%')}
                  style={{
                    width: '100%', height: 220, fontFamily: 'monospace', fontSize: 12,
                    border: '1px solid #d1d5db', borderRadius: 8, padding: 12,
                    resize: 'vertical', boxSizing: 'border-box', color: '#374151',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button
                    onClick={handleParse}
                    disabled={!markdown.trim()}
                    style={{
                      padding: '8px 20px', borderRadius: 8, border: 'none',
                      background: markdown.trim() ? '#1877F2' : '#d1d5db',
                      color: '#fff', fontWeight: 700, fontSize: 13,
                      cursor: markdown.trim() ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {L('解析預覽', 'Parse preview')}
                  </button>
                </div>
              </>
            )}

            {status === 'preview' && preview && (
              <>
                <PreviewPanel preview={preview} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button
                    onClick={reset}
                    style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151' }}
                  >
                    {L('重新貼入', 'Paste again')}
                  </button>
                  <button
                    onClick={handleImport}
                    style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  >
                    {L('確認寫入 Firebase', 'Confirm & write to Firebase')}
                  </button>
                </div>
              </>
            )}

            {status === 'importing' && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280', fontSize: 13 }}>
                {L('寫入中，請稍候…', 'Writing, please wait…')}
              </div>
            )}

            {status === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{L('匯入完成', 'Import complete')}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, lineHeight: 1.8 }}>
                  {result.pageInsightsSaved && <div>{L('粉絲頁整體洞察已儲存', 'Page-level insights saved')}</div>}
                  {result.postReachUpdated > 0 && (
                    <div>
                      {L('貼文觸及更新 ', 'Post reach updated ')}<strong>{result.postReachUpdated}</strong>{L(' 筆', '')}
                      {result.postReachSkipped > 0 && L(`，略過 ${result.postReachSkipped} 筆`, `, skipped ${result.postReachSkipped}`)}
                    </div>
                  )}
                  {(result.bizUpdated > 0 || result.bizCreated > 0) && (
                    <div>
                      {L('Business Suite 貼文更新 ', 'Business Suite posts updated ')}<strong>{result.bizUpdated}</strong>{L(' 筆', '')}
                      {result.bizCreated > 0 && L(`，新建 ${result.bizCreated} 筆`, `, created ${result.bizCreated}`)}
                      {result.bizSkipped > 0 && L(`，略過 ${result.bizSkipped} 筆（無日期）`, `, skipped ${result.bizSkipped} (no date)`)}
                    </div>
                  )}
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ color: '#d97706', fontSize: 12, marginTop: 4 }}>⚠ {w}</div>
                  ))}
                </div>
                <button
                  onClick={() => { setOpen(false); reset() }}
                  style={{ marginTop: 20, padding: '8px 24px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  {L('關閉', 'Close')}
                </button>
              </div>
            )}

            {status === 'error' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626' }}>{error}</div>
                <button
                  onClick={reset}
                  style={{ marginTop: 16, padding: '7px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}
                >
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

function PreviewPanel({ preview }: { preview: ParseResult }) {
  const { L } = useLang()
  const { pageInsights, postReachRows, bizSuiteRows, warnings } = preview

  return (
    <div style={{ fontSize: 13 }}>
      {warnings.map((w, i) => (
        <div key={i} style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '8px 12px', marginBottom: 10, color: '#92400e', fontSize: 12,
        }}>
          ⚠ {w}
        </div>
      ))}

      {pageInsights && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#111' }}>{L('粉絲頁整體洞察', 'Page-level insights')}</div>
          {pageInsights.periodLabel && (
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{L('期間：', 'Period: ')}{pageInsights.periodLabel}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {[
              { label: L('瀏覽次數', 'Views'), value: pageInsights.pageViews },
              { label: L('影片觀看（3秒+）', 'Video views (3s+)'), value: pageInsights.videoViews3s },
              { label: L('影片觀看（1分鐘+）', 'Video views (1min+)'), value: pageInsights.videoViews1m },
              { label: L('觀看時間（分鐘）', 'Watch time (min)'), value: pageInsights.watchTimeMin },
              { label: L('追蹤者 %', 'Followers %'), value: pageInsights.followerPct ? `${pageInsights.followerPct}%` : '—' },
              { label: L('非追蹤者 %', 'Non-followers %'), value: pageInsights.nonFollowerPct ? `${pageInsights.nonFollowerPct}%` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#f9fafb', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#111', marginTop: 2 }}>{value || '—'}</div>
              </div>
            ))}
          </div>
          {Object.keys(pageInsights.contentType).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{L('內容類型分布', 'Content type distribution')}</div>
              {Object.entries(pageInsights.contentType).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 56, fontSize: 11, color: '#374151', flexShrink: 0 }}>{k}</div>
                  <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3 }}>
                    <div style={{ width: `${v}%`, height: '100%', background: '#1877F2', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#374151', width: 36, textAlign: 'right' }}>{v}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {postReachRows.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#111' }}>
            {L('貼文觸及（', 'Post reach (')}{postReachRows.length}{L(' 筆）', ')')}
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{L('連結', 'Link')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('觸及', 'Reach')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('曝光', 'Impr.')}</th>
                </tr>
              </thead>
              <tbody>
                {postReachRows.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6b7280' }}>
                      {row.permalink}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#111', fontWeight: 600 }}>{row.reach.toLocaleString()}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#6b7280' }}>{row.impressions ? row.impressions.toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {postReachRows.length > 10 && (
                  <tr><td colSpan={3} style={{ padding: '4px 10px', color: '#9ca3af', fontSize: 11 }}>{L(`…還有 ${postReachRows.length - 10} 筆`, `…and ${postReachRows.length - 10} more`)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bizSuiteRows.length > 0 && (
        <div style={{ marginTop: postReachRows.length > 0 ? 16 : 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#111' }}>
            {L('Business Suite 貼文（', 'Business Suite posts (')}{bizSuiteRows.length}{L(' 筆）', ')')}
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{L('日期', 'Date')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{L('內容', 'Content')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('觸及', 'Reach')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('按讚', 'Likes')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('留言', 'Comments')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('分享', 'Shares')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{L('觀看(3s)', 'Views(3s)')}</th>
                </tr>
              </thead>
              <tbody>
                {bizSuiteRows.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 10px', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.publishDateLabel}</td>
                    <td style={{ padding: '5px 10px', color: row.content ? '#374151' : '#9ca3af', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: row.content ? 'normal' : 'italic' }}>
                      {row.content ?? L('（無文字內容）', '(no text)')}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#111', fontWeight: 600 }}>{row.reach.toLocaleString()}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#6b7280' }}>{row.likes}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#6b7280' }}>{row.comments}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#6b7280' }}>{row.shares}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: row.videoViews3s > 0 ? '#111' : '#d1d5db' }}>{row.videoViews3s > 0 ? row.videoViews3s.toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {bizSuiteRows.length > 10 && (
                  <tr><td colSpan={7} style={{ padding: '4px 10px', color: '#9ca3af', fontSize: 11 }}>{L(`…還有 ${bizSuiteRows.length - 10} 筆`, `…and ${bizSuiteRows.length - 10} more`)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            {L('將依發佈時間（±5分鐘）對應現有 fbPosts 並補齊欄位', 'Will match existing fbPosts by publish time (±5 min) and fill in fields')}
          </div>
        </div>
      )}

      {!pageInsights && postReachRows.length === 0 && bizSuiteRows.length === 0 && (
        <div style={{ color: '#dc2626', fontSize: 13 }}>{L('未能解析任何資料，請重新貼入內容。', "Couldn't parse any data — please paste the content again.")}</div>
      )}
    </div>
  )
}
