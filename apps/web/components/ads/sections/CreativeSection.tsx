'use client'

import { useState, useMemo } from 'react'
import { Icon } from '../Icon'
import type { AdData } from '../types'

const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`
const STATUS_LABEL: Record<string, string> = { top: '🏆 最佳', good: '👍 良好', ok: '一般', bad: '⚠️ 待優' }
const TYPES = ['全部', 'Reels', '貼文', 'Stories', '海報']
type SortBy = 'roas' | 'spend' | 'cpa'

const STATUS_LABEL_TEXT: Record<string, string> = { top: '最佳', good: '良好', ok: '一般', bad: '待優' }

function buildCreativePrompt(c: AdData['creatives'][number]): string {
  return `請分析這個廣告素材：\n《${c.name}》\n類型：${c.type}｜頻道：${c.channel}｜狀態：${STATUS_LABEL_TEXT[c.status] ?? c.status}\nROAS：${c.roas.toFixed(1)}x｜花費：$${c.spend}｜CTR：${Number(c.ctr).toFixed(2)}%｜CPA：$${c.cpa}｜曝光：${c.impressions.toLocaleString()}\n\n請給出這個素材的成效診斷和具體優化建議。`
}

const PlatformIcon = ({ type }: { type: 'IG' | 'FB' }) => (
  <span style={{ 
    display: 'inline-flex', 
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 5px', 
    borderRadius: 6, 
    fontSize: 10, 
    fontWeight: 700, 
    marginRight: 6,
    verticalAlign: 'text-bottom',
    ...(type === 'IG' 
      ? { background: '#fce4ec', color: '#c2185b' } 
      : { background: '#e3f2fd', color: '#1976d2' })
  }}>
    {type}
  </span>
)

function renderAdName(name: string) {
  let isIg = false
  let cleanName = name
  
  if (/^Instagram (post|貼文)[:：\s]*/i.test(name)) {
    isIg = true
    cleanName = name.replace(/^Instagram (post|貼文)[:：\s]*/i, '')
  } else if (/Instagram/i.test(name)) {
    isIg = true
  }
  
  return (
    <>
      <PlatformIcon type={isIg ? 'IG' : 'FB'} />
      {cleanName}
    </>
  )
}

export function CreativeSection({ data, onAskAI }: { data: AdData; onAskAI: (q: string, autoSend?: boolean) => void }) {
  const [sortBy, setSortBy] = useState<SortBy>('roas')
  const [filter, setFilter] = useState('全部')

  const sorted = useMemo(() => {
    let arr = [...data.creatives]
    if (filter !== '全部') arr = arr.filter(c => c.type === filter)
    if (sortBy === 'roas') arr.sort((a, b) => b.roas - a.roas)
    else if (sortBy === 'spend') arr.sort((a, b) => b.spend - a.spend)
    else arr.sort((a, b) => a.cpa - b.cpa)
    return arr
  }, [data.creatives, sortBy, filter])

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="creative" size={15} color="var(--ad-blue)" />
        <span className="ads-section-title">素材庫 &amp; 績效排行</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="ads-diag-ask-btn" style={{ borderRadius: 7 }} onClick={() => onAskAI('哪支素材表現最好？')}>✨ 問 AI 分析素材</button>
          <div className="ads-tabs">
            {TYPES.map(t => <button key={t} className={`ads-tab ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>{t}</button>)}
          </div>
          <select
            style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--ad-border)', borderRadius: 7, background: 'var(--ad-surface)', color: 'var(--ad-text2)', cursor: 'pointer', fontFamily: 'var(--font-dm-sans)' }}
            value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
          >
            <option value="roas">點擊效益 ↓</option>
            <option value="spend">花費 ↓</option>
            <option value="cpa">CPA ↑</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--ad-text3)', padding: 40 }}>
          尚無廣告素材資料，請先同步廣告數據
        </p>
      )}
      <div className="ads-creative-grid">
        {sorted.map((c, i) => (
          <div key={c.id} className="ads-creative-card" style={{ position: 'relative' }}>
            <button
              title="用 AI 分析此素材"
              onClick={() => onAskAI(buildCreativePrompt(c), true)}
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4 }}
            >✨ 分析</button>
            <div className={`ads-creative-thumb ${c.thumb}`}>
              <div className={`ads-creative-rank ${c.status === 'top' ? 'top' : c.status === 'bad' ? 'bad' : ''}`}>{i + 1}</div>
              <div className={`ads-creative-status ${c.status}`}>{STATUS_LABEL[c.status]}</div>
              <span style={{ opacity: 0.5 }}>{c.type} · {c.channel}</span>
            </div>
            <div className="ads-creative-info">
              <div className="ads-creative-name">{renderAdName(c.name)}</div>
              <div className="ads-creative-meta">
                {[['ROAS', c.roas.toFixed(1) + 'x'], ['花費', fmtK(c.spend)], ['CTR', Number(c.ctr).toFixed(2) + '%'], ['CPA', '$' + c.cpa]].map(([k, v]) => (
                  <div key={k} className="ads-creative-kv">
                    <span style={{ color: 'var(--ad-text3)' }}>{k}</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
