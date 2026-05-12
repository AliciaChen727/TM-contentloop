'use client'

import { useState, useMemo } from 'react'
import type { Post } from '../types'

const fmt = (n: number | null) => n == null ? '—' : n.toLocaleString('zh-TW')
const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`

type Platform = 'all' | 'fb' | 'ig'
type View = 'raw' | 'ads'
type SortKey = 'date' | 'reach' | 'likes' | 'comments' | 'saves' | 'shares' | 'plays'

function PlatBadge({ p }: { p: string }) {
  if (p === 'FB') return <span className="ads-posts-platform-badge fb">FB</span>
  if (p === 'IG') return <span className="ads-posts-platform-badge ig">IG</span>
  return <span className="ads-posts-platform-badge both">FB+IG</span>
}

function SortTh({ k, label, sortKey, sortDir, onSort }: { k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void }) {
  return (
    <th className={sortKey === k ? 'sorted' : ''} onClick={() => onSort(k)} style={{ cursor: 'pointer' }}>
      {label}<span style={{ marginLeft: 4, opacity: sortKey === k ? 1 : 0.4, fontSize: 10, color: sortKey === k ? 'var(--ad-blue)' : undefined }}>{sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </th>
  )
}

function buildPostPrompt(p: Post): string {
  const eng = (p.reach ?? 0) > 0 ? ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100).toFixed(2) : '0.00'
  const adPart = p.hasAd ? `\nROAS：${(p.adRoas ?? 0).toFixed(1)}x｜廣告花費：$${p.adSpend ?? 0}｜CPA：$${p.adCpa ?? 0}｜廣告 CTR：${Number(p.adCtr ?? 0).toFixed(2)}%` : ''
  return `請分析這篇貼文：\n日期：${p.date}｜平台：${p.platform}｜類型：${p.type === 'reels' ? 'Reels' : '貼文'}\n內容：${p.title.slice(0, 100)}\n觸及：${fmt(p.reach)}｜按讚：${p.likes}｜留言：${p.comments}｜收藏：${fmt(p.saves)}｜分享：${p.shares}｜播放：${fmt(p.plays)}\n互動率：${eng}%${adPart}\n\n請給出成效診斷和具體優化建議。`
}

export function PostsSection({ onAskAI, posts }: { onAskAI: (q: string, autoSend?: boolean) => void; posts: Post[] | null }) {
  const [platform, setPlatform] = useState<Platform>('all')
  const [view, setView] = useState<View>('raw')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    if (!posts) return []
    let arr: Post[] = [...posts]
    if (platform === 'fb') arr = arr.filter(p => p.platform === 'FB' || p.platform === 'FB+IG')
    if (platform === 'ig') arr = arr.filter(p => p.platform === 'IG' || p.platform === 'FB+IG')
    if (typeFilter === 'post') arr = arr.filter(p => p.type === 'post')
    if (typeFilter === 'reels') arr = arr.filter(p => p.type === 'reels')
    if (typeFilter === 'ads') arr = arr.filter(p => p.hasAd)
    if (search) arr = arr.filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
    arr.sort((a, b) => {
      const va = sortKey === 'date' ? a.date : (a[sortKey] as number | null) ?? -1
      const vb = sortKey === 'date' ? b.date : (b[sortKey] as number | null) ?? -1
      if (va == null) return 1; if (vb == null) return -1
      return sortDir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1)
    })
    return arr
  }, [posts, platform, sortKey, sortDir, typeFilter, search])

  const adPosts = useMemo(() => filtered.filter(p => p.hasAd), [filtered])
  const maxRoas = Math.max(0, ...adPosts.map(p => p.adRoas ?? 0))

  if (posts === null) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ad-text3)', fontSize: 13 }}>
        載入貼文資料中⋯⋯
      </div>
    )
  }

  const fbCount = posts.filter(p => p.platform === 'FB' || p.platform === 'FB+IG').length
  const igCount = posts.filter(p => p.platform === 'IG' || p.platform === 'FB+IG').length
  const totalReach = posts.reduce((s, p) => s + (p.reach ?? 0), 0)
  const totalLikes = posts.reduce((s, p) => s + p.likes, 0)
  const totalComments = posts.reduce((s, p) => s + p.comments, 0)
  const totalShares = posts.reduce((s, p) => s + p.shares, 0)
  const reachPosts = posts.filter(p => (p.reach ?? 0) > 0)
  const avgEng = reachPosts.length > 0
    ? reachPosts.reduce((s, p) => s + ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100), 0) / reachPosts.length
    : 0

  const roasColor = (r: number) => r >= 4.5 ? 'var(--ad-green)' : r >= 3.5 ? 'var(--ad-blue)' : r >= 2.5 ? 'var(--ad-orange)' : 'var(--ad-red)'

  return (
    <div>
      <div className="ads-posts-summary-strip">
        {[
          { label: '總貼文數', value: posts.length, sub: `${posts.filter(p => p.type === 'reels').length} Reels · ${posts.filter(p => p.type === 'post').length} 貼文` },
          { label: '總觸及', value: totalReach >= 1000 ? `${(totalReach / 1000).toFixed(1)}K` : totalReach, sub: '所有貼文合計' },
          { label: '總按讚', value: totalLikes.toLocaleString(), sub: `留言 ${totalComments} · 分享 ${totalShares}` },
          { label: '平均互動率', value: `${avgEng.toFixed(2)}%`, sub: '(按讚+留言+分享)/觸及' },
          { label: '有投廣告', value: `${adPosts.length} 篇`, sub: adPosts.length > 0 ? `最高 ROAS ${maxRoas.toFixed(1)}x` : '尚未串接廣告數據' },
        ].map(s => (
          <div key={s.label} className="ads-posts-sum-card">
            <div className="ads-posts-sum-label">{s.label}</div>
            <div className="ads-posts-sum-value">{s.value}</div>
            <div className="ads-posts-sum-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="ads-posts-toolbar">
        <div className="ads-posts-platform-tabs">
          {([['all', 'FB + IG', null], ['fb', 'Facebook', fbCount], ['ig', 'Instagram', igCount]] as [Platform, string, number | null][]).map(([v, l, c]) => (
            <button key={v} className={`ads-posts-platform-tab ${platform === v ? 'active' : ''}`} onClick={() => setPlatform(v)}>
              {l}{c !== null && <span className="badge">{c}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['all', '全部'], ['post', '貼文'], ['reels', 'Reels'], ['ads', '有投廣告']] as [string, string][]).map(([v, l]) => (
            <button key={v} className={`ads-posts-type-chip ${typeFilter === v ? 'active' : ''}`} onClick={() => setTypeFilter(v)}>{l}</button>
          ))}
        </div>
        <input className="ads-posts-search" placeholder="搜尋貼文內容…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="ads-posts-view-toggle">
          <button className={`ads-posts-view-btn ${view === 'raw' ? 'active' : ''}`} onClick={() => setView('raw')}>📋 原始數據</button>
          <button className={`ads-posts-view-btn ${view === 'ads' ? 'active' : ''}`} onClick={() => setView('ads')}>📊 廣告指標</button>
        </div>
        <button className="ads-diag-ask-btn" style={{ borderRadius: 7, flexShrink: 0 }} onClick={() => onAskAI('哪支素材表現最好？')}>✨ 問 AI 分析</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, fontSize: 11.5, color: 'var(--ad-text3)', gap: 6, alignItems: 'center' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ad-green)', display: 'inline-block' }} />
        每日凌晨 3 點自動更新 · 最後同步 2026-05-05 03:00
      </div>

      {view === 'raw' && (
        <div className="ads-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="ads-posts-table">
              <thead>
                <tr>
                  <SortTh k="date" label="日期" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th>平台</th><th>內容</th>
                  <SortTh k="reach" label="觸及" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="likes" label="按讚" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="comments" label="留言" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="saves" label="收藏" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="shares" label="分享" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="plays" label="播放" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th>互動率</th><th>廣告</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const eng = (p.reach ?? 0) > 0 ? ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100) : 0
                  return (
                    <tr key={p.id}>
                      <td className="ads-posts-date">{p.date}</td>
                      <td><PlatBadge p={p.platform} /></td>
                      <td style={{ maxWidth: 260 }}>
                        {p.url && p.url !== '#' ? (
                          <a href={p.url} style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">{p.title}</a>
                        ) : (
                          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ad-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                        )}
                        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, marginTop: 3, background: p.type === 'reels' ? '#FFF3E0' : 'var(--ad-surface2)', color: p.type === 'reels' ? '#E65100' : 'var(--ad-text3)' }}>
                          {p.type === 'reels' ? '▶ Reels' : '📝 貼文'}
                        </span>
                      </td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>
                        {p.reach != null ? <span style={{ color: p.reach > 200 ? 'var(--ad-green)' : undefined, fontWeight: p.reach > 200 ? 600 : undefined }}>{fmt(p.reach)}</span> : <span style={{ color: 'var(--ad-text3)' }}>—</span>}
                      </td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.likes)}</td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.comments)}</td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>{p.saves != null ? fmt(p.saves) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}</td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>{fmt(p.shares)}</td>
                      <td className="ads-posts-num" style={{ textAlign: 'right' }}>{p.plays != null ? fmt(p.plays) : <span style={{ color: 'var(--ad-text3)' }}>—</span>}</td>
                      <td style={{ minWidth: 70 }}>
                        {(p.reach ?? 0) > 0 ? (
                          <>
                            <div style={{ fontSize: 10.5, fontFamily: 'var(--font-dm-mono)', color: eng > 2 ? 'var(--ad-green)' : eng > 0.5 ? 'var(--ad-text2)' : 'var(--ad-text3)', marginBottom: 3 }}>{eng.toFixed(2)}%</div>
                            <div style={{ height: 4, borderRadius: 2, background: 'var(--ad-surface2)', overflow: 'hidden', width: 60 }}>
                              <div style={{ height: '100%', borderRadius: 2, background: eng > 2 ? 'var(--ad-green)' : 'var(--ad-blue)', width: `${Math.min(eng / 5 * 100, 100)}%` }} />
                            </div>
                          </>
                        ) : <span style={{ color: 'var(--ad-text3)', fontSize: 12 }}>—</span>}
                      </td>
                      <td>
                        {p.hasAd ? (
                          <div>
                            <span className="ads-posts-ad-badge">🎯 有投放</span>
                            {(p.paidReach ?? 0) > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--ad-text3)', marginTop: 2 }}>觸及 {fmt(p.paidReach ?? 0)}</div>
                            )}
                          </div>
                        ) : <span style={{ color: 'var(--ad-text3)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                        <button
                          title="用 AI 分析此貼文"
                          onClick={() => onAskAI(buildPostPrompt(p), true)}
                          style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                        >✨ 分析</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)', display: 'flex', justifyContent: 'space-between' }}>
            <span>共 {filtered.length} 筆記錄</span>
            <span>點擊內容標題可前往原始貼文連結</span>
          </div>
        </div>
      )}

      {view === 'ads' && (
        adPosts.length === 0
          ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ad-text3)' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>目前篩選條件下無廣告貼文</div>
              <div style={{ fontSize: 12 }}>廣告數據將於串接 Meta Ads Manager 後顯示</div>
            </div>
          : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--ad-text2)', marginBottom: 12 }}>共 <strong>{adPosts.length}</strong> 篇貼文有投廣告：</div>
              <div className="ads-posts-ad-grid">
                {adPosts.map(p => {
                  const rc = roasColor(p.adRoas ?? 0)
                  return (
                    <div key={p.id} className="ads-posts-ad-card" style={{ position: 'relative' }}>
                      <button
                        title="用 AI 分析此貼文"
                        onClick={() => onAskAI(buildPostPrompt(p), true)}
                        style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4 }}
                      >✨ 分析</button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-dm-mono)', color: 'var(--ad-text3)' }}>{p.date}</span>
                        <PlatBadge p={p.platform} />
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4, marginBottom: 10 }}>{p.title}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                        {[['ROAS', (p.adRoas ?? 0).toFixed(1) + 'x', rc], ['花費', fmtK(p.adSpend ?? 0), undefined], ['CPA', '$' + (p.adCpa ?? 0), undefined], ['CTR', Number(p.adCtr ?? 0).toFixed(2) + '%', undefined]].map(([label, value, color]) => (
                          <div key={label as string}>
                            <div className="ads-posts-ad-metric-label">{label}</div>
                            <div className="ads-posts-ad-metric-value" style={{ color: color as string | undefined }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="ads-posts-ad-roas-bar">
                        <div className="ads-posts-ad-roas-fill" style={{ width: `${((p.adRoas ?? 0) / maxRoas) * 100}%`, background: rc }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
      )}
    </div>
  )
}
