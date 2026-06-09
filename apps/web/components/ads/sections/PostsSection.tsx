'use client'

import { useState, useMemo } from 'react'
import type { Post } from '../types'
import { useLang } from '@/lib/i18n/LanguageProvider'

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

function buildPostPrompt(p: Post, en: boolean): string {
  const eng = (p.reach ?? 0) > 0 ? ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100).toFixed(2) : '0.00'
  const hasAdMetrics = p.hasAd && ((p.adSpend ?? 0) > 0 || (p.adRoas ?? 0) > 0)
  if (en) {
    const adPart = p.hasAd
      ? hasAdMetrics
        ? `\nCPL: $${(p.adCpa ?? 0).toFixed(2)} | Ad spend: $${p.adSpend ?? 0} | Ad CTR: ${Number(p.adCtr ?? 0).toFixed(2)}%`
        : '\nThis post has ads, but ad detail data is not synced yet (re-sync to view).'
      : ''
    return `Please analyze this post:\nDate: ${p.date} | Platform: ${p.platform} | Type: ${p.type === 'reels' ? 'Reels' : 'Post'}\nContent: ${p.title.slice(0, 100)}\nReach: ${fmt(p.reach)} | Likes: ${p.likes} | Comments: ${p.comments} | Saves: ${fmt(p.saves)} | Shares: ${p.shares} | Plays: ${fmt(p.plays)}\nEngagement: ${eng}%${adPart}\n\nPlease give a performance diagnosis and specific optimization suggestions.`
  }
  const adPart = p.hasAd
    ? hasAdMetrics
      ? `\nCPL：$${(p.adCpa ?? 0).toFixed(2)}｜廣告花費：$${p.adSpend ?? 0}｜廣告 CTR：${Number(p.adCtr ?? 0).toFixed(2)}%`
      : '\n此貼文有投放廣告，但廣告細項數據尚未同步（可重新同步後查看）'
    : ''
  return `請分析這篇貼文：\n日期：${p.date}｜平台：${p.platform}｜類型：${p.type === 'reels' ? 'Reels' : '貼文'}\n內容：${p.title.slice(0, 100)}\n觸及：${fmt(p.reach)}｜按讚：${p.likes}｜留言：${p.comments}｜收藏：${fmt(p.saves)}｜分享：${p.shares}｜播放：${fmt(p.plays)}\n互動率：${eng}%${adPart}\n\n請給出成效診斷和具體優化建議。`
}

export function PostsSection({ onAskAI, posts }: { onAskAI?: (q: string, autoSend?: boolean) => void; posts: Post[] | null }) {
  const { L, lang } = useLang()
  const en = lang === 'en'
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
        {L('載入貼文資料中⋯⋯', 'Loading posts…')}
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
          { label: L('總貼文數', 'Total posts'), value: posts.length, sub: L(`${posts.filter(p => p.type === 'reels').length} Reels · ${posts.filter(p => p.type === 'post').length} 貼文`, `${posts.filter(p => p.type === 'reels').length} Reels · ${posts.filter(p => p.type === 'post').length} posts`) },
          { label: L('總觸及', 'Total reach'), value: totalReach >= 1000 ? `${(totalReach / 1000).toFixed(1)}K` : totalReach, sub: L('所有貼文合計', 'All posts combined') },
          { label: L('總按讚', 'Total likes'), value: totalLikes.toLocaleString(), sub: L(`留言 ${totalComments} · 分享 ${totalShares}`, `${totalComments} comments · ${totalShares} shares`) },
          { label: L('平均互動率', 'Avg engagement'), value: `${avgEng.toFixed(2)}%`, sub: L('(按讚+留言+分享)/觸及', '(likes+comments+shares)/reach') },
          { label: L('有投廣告', 'Boosted'), value: L(`${adPosts.length} 篇`, `${adPosts.length}`), sub: adPosts.length === 0 ? L('尚未串接廣告數據', 'No ad data connected') : adPosts.some(p => (p.adSpend ?? 0) > 0 || (p.adRoas ?? 0) > 0) ? L(`最低 CPA $${maxRoas.toFixed(2)}`, `Min CPA $${maxRoas.toFixed(2)}`) : L('僅偵測到付費觸及（無花費數據）', 'Paid reach detected only (no spend data)') },
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
          {([['all', L('全部', 'All')], ['post', L('貼文', 'Posts')], ['reels', 'Reels'], ['ads', L('有投廣告', 'Boosted')]] as [string, string][]).map(([v, l]) => (
            <button key={v} className={`ads-posts-type-chip ${typeFilter === v ? 'active' : ''}`} onClick={() => setTypeFilter(v)}>{l}</button>
          ))}
        </div>
        <input className="ads-posts-search" placeholder={L('搜尋貼文內容…', 'Search posts…')} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="ads-posts-view-toggle">
          <button className={`ads-posts-view-btn ${view === 'raw' ? 'active' : ''}`} onClick={() => setView('raw')}>📋 {L('原始數據', 'Raw data')}</button>
          <button className={`ads-posts-view-btn ${view === 'ads' ? 'active' : ''}`} onClick={() => setView('ads')}>📊 {L('廣告指標', 'Ad metrics')}</button>
        </div>
        {onAskAI && <button className="ads-diag-ask-btn" style={{ borderRadius: 7, flexShrink: 0 }} onClick={() => onAskAI(L('哪支素材表現最好？', 'Which creative performs best?'))}>✨ {L('問 AI 分析', 'Ask AI')}</button>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, fontSize: 11.5, color: 'var(--ad-text3)', gap: 6, alignItems: 'center' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ad-green)', display: 'inline-block' }} />
        {L('每日凌晨 3 點自動更新', 'Auto-updates daily at 3 AM')}
      </div>

      {view === 'raw' && (
        <div className="ads-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="ads-posts-table">
              <thead>
                <tr>
                  <SortTh k="date" label={L('日期', 'Date')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th>{L('平台', 'Platform')}</th><th>{L('內容', 'Content')}</th>
                  <SortTh k="reach" label={L('觸及', 'Reach')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="likes" label={L('按讚', 'Likes')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="comments" label={L('留言', 'Comments')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="saves" label={L('收藏', 'Saves')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="shares" label={L('分享', 'Shares')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh k="plays" label={L('播放', 'Plays')} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th>{L('互動率', 'Engagement')}</th><th>{L('廣告', 'Ad')}</th>
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
                          {p.type === 'reels' ? '▶ Reels' : L('📝 貼文', '📝 Post')}
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
                            <span className="ads-posts-ad-badge">🎯 {L('有投放', 'Boosted')}</span>
                            {(p.paidReach ?? 0) > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--ad-text3)', marginTop: 2 }}>{L('觸及', 'Reach')} {fmt(p.paidReach ?? 0)}</div>
                            )}
                          </div>
                        ) : <span style={{ color: 'var(--ad-text3)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', paddingLeft: 4, paddingRight: 8 }}>
                        {onAskAI && <button
                          title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                          onClick={() => onAskAI(buildPostPrompt(p, en), true)}
                          style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}
                        >✨ {L('分析', 'Analyze')}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{L(`共 ${filtered.length} 筆記錄`, `${filtered.length} records`)}</span>
            <span>{L('點擊內容標題可前往原始貼文連結', 'Click a content title to open the original post')}</span>
          </div>
        </div>
      )}

      {view === 'ads' && (
        adPosts.length === 0
          ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ad-text3)' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>{L('目前篩選條件下無廣告貼文', 'No boosted posts under the current filter')}</div>
              <div style={{ fontSize: 12 }}>{L('廣告數據將於串接 Meta Ads Manager 後顯示', 'Ad data appears once Meta Ads Manager is connected')}</div>
            </div>
          : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--ad-text2)', marginBottom: 12 }}>{L('共 ', '')}<strong>{adPosts.length}</strong>{L(' 篇貼文有投廣告：', ' boosted posts:')}</div>
              <div className="ads-posts-ad-grid">
                {adPosts.map(p => {
                  const rc = roasColor(p.adRoas ?? 0)
                  // Real ad-account metrics available? Otherwise this post is only
                  // flagged via paid reach (the boosting ad account isn't accessible
                  // to us), so spend/CPA/CTR genuinely cannot be computed — show the
                  // paid reach we DO have instead of a misleading $0 / 0.00%.
                  const hasAdMetrics = (p.adSpend ?? 0) > 0 || (p.adRoas ?? 0) > 0
                  return (
                    <div key={p.id} className="ads-posts-ad-card" style={{ position: 'relative' }}>
                      {onAskAI && <button
                        title={L('用 AI 分析此貼文', 'Analyze this post with AI')}
                        onClick={() => onAskAI(buildPostPrompt(p, en), true)}
                        style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4 }}
                      >✨ {L('分析', 'Analyze')}</button>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-dm-mono)', color: 'var(--ad-text3)' }}>{p.date}</span>
                        <PlatBadge p={p.platform} />
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4, marginBottom: 10 }}>{p.title}</div>
                      {hasAdMetrics ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                            {[['CPA', '$' + (p.adCpa ?? 0).toFixed(2), rc], [L('花費', 'Spend'), fmtK(p.adSpend ?? 0), undefined], ['CTR', Number(p.adCtr ?? 0).toFixed(2) + '%', undefined]].map(([label, value, color]) => (
                              <div key={label as string}>
                                <div className="ads-posts-ad-metric-label">{label}</div>
                                <div className="ads-posts-ad-metric-value" style={{ color: color as string | undefined }}>{value}</div>
                              </div>
                            ))}
                          </div>
                          <div className="ads-posts-ad-roas-bar">
                            <div className="ads-posts-ad-roas-fill" style={{ width: `${((p.adRoas ?? 0) / maxRoas) * 100}%`, background: rc }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                            <div>
                              <div className="ads-posts-ad-metric-label">{L('付費觸及', 'Paid reach')}</div>
                              <div className="ads-posts-ad-metric-value">{(p.paidReach ?? 0) > 0 ? fmt(p.paidReach ?? 0) : '—'}</div>
                            </div>
                            <div>
                              <div className="ads-posts-ad-metric-label">{L('自然觸及', 'Organic reach')}</div>
                              <div className="ads-posts-ad-metric-value">{(p.organicReach ?? 0) > 0 ? fmt(p.organicReach ?? 0) : '—'}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--ad-text3)', marginTop: 8, lineHeight: 1.5 }}>
                            {L('此貼文偵測到付費推廣，但連接的帳號讀不到對應廣告帳號，無法顯示花費 / CTR。', "This post shows paid promotion, but the connected account can't access the corresponding ad account, so spend / CTR can't be shown.")}
                          </div>
                        </>
                      )}
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
