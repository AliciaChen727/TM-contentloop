'use client'

import { SvgChart } from '../SvgCharts'
import { Icon } from '../Icon'
import { POSTS_DATA } from '../mockData'
import type { AdData, Post } from '../types'

const fmt = (n: number, d = 0) => n == null ? '–' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtK = (n: number) => n >= 10000 ? `$${fmt(Math.round(n / 1000))}K` : `$${fmt(n)}`

export function OverviewSection({ data, onAskAI, posts }: { data: AdData; onAskAI: (q: string) => void; posts?: Post[] | null }) {
  const s = data.overview.summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convType = (data as any).conversionType as string | undefined
  const isClickBased = convType === 'link_click'
  const isVideoBased = convType === 'video_view'
  const budgetPct = (s.spend / data.budget.total) * 100
  const roasLabel = isVideoBased ? '觀看效益' : isClickBased ? '點擊效益' : 'CPL'
  const roasUnit = isVideoBased || isClickBased ? '次/百元' : 'x'
  const cpaLabel = isVideoBased ? 'CPV' : isClickBased ? 'CPC' : 'CPA'
  const cpaQ = isVideoBased ? 'CPV 如何進一步降低？' : isClickBased ? 'CPC 如何進一步降低？' : 'CPA 如何進一步降低？'
  const convLabel = isVideoBased ? '影片觀看' : isClickBased ? '點擊數' : '轉換數'
  const convMeta = isVideoBased ? '影片觀看次數' : isClickBased ? '連結點擊次數' : `營收 ${fmtK(s.revenue ?? 0)}`
  const roas = s.roas ?? 0
  const frequency = s.frequency ?? 0
  const reach = s.reach ?? 0
  const impressions = s.impressions ?? 0
  const kpis = [
    { label: roasLabel, value: roas.toFixed(2) + roasUnit, meta: `目標 ${s.roasTarget}${roasUnit}`, color: roas >= s.roasTarget ? 'green' : 'orange', delta: s.roasTarget > 0 ? `${roas >= s.roasTarget ? '+' : ''}${((roas - s.roasTarget) / s.roasTarget * 100).toFixed(0)}%` : '', dir: roas >= s.roasTarget ? 'up' : 'down', q: isVideoBased ? '影片廣告效益如何提升？' : isClickBased ? '廣告點擊效益如何提升？' : 'CPL 如何降低？' },
    { label: '總花費', value: fmtK(s.spend ?? 0), meta: `預算 ${fmtK(data.budget.total)}`, color: 'blue', delta: `${budgetPct.toFixed(0)}%`, dir: 'neutral', q: '預算怎麼分配最划算？' },
    { label: cpaLabel, value: `$${fmt(s.cpa ?? 0)}`, meta: `目標 $${fmt(s.cpaTarget ?? 0)}`, color: (s.cpa ?? 0) > 0 && (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'green' : 'orange', delta: (s.cpa ?? 0) > 0 && (s.cpaTarget ?? 0) > 0 ? ((s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? `-${(((s.cpaTarget ?? 0) - (s.cpa ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%` : `+${(((s.cpa ?? 0) - (s.cpaTarget ?? 0)) / (s.cpaTarget ?? 1) * 100).toFixed(0)}%`) : '', dir: (s.cpa ?? 0) <= (s.cpaTarget ?? 0) ? 'up' : 'down', q: cpaQ },
    { label: 'CTR', value: `${fmt(s.ctr ?? 0, 2)}%`, meta: '業界均值 1.8%', color: 'blue', delta: '+19%', dir: 'up', q: '哪支素材表現最好？' },
    { label: 'CPM', value: `$${fmt(s.cpm ?? 0, 2)}`, meta: '千次曝光', color: 'orange', delta: '', dir: 'neutral', q: 'CPM 為什麼上升？' },
    { label: '總觸及', value: `${(reach / 10000).toFixed(0)}萬`, meta: `曝光 ${(impressions / 10000).toFixed(0)}萬次`, color: 'blue', delta: '', dir: 'neutral', q: '如何擴大觸及？' },
    { label: convLabel, value: fmt(s.conversions ?? 0), meta: convMeta, color: 'green', delta: '', dir: 'neutral', q: '哪個組合轉換最好？' },
    { label: '頻率', value: frequency.toFixed(2), meta: '建議 < 3.5', color: frequency > 3.5 ? 'red' : 'green', delta: frequency > 3.5 ? '⚠ 偏高' : '正常', dir: frequency > 3.5 ? 'down' : 'up', q: '我的受眾是否疲乏了？' },
  ]

  const postsSource = posts ?? POSTS_DATA
  const adPosts = postsSource.filter(p => p.hasAd)
  const reachPosts = postsSource.filter(p => (p.reach ?? 0) > 0)
  const avgReach = reachPosts.length > 0 ? Math.round(reachPosts.reduce((s, p) => s + (p.reach ?? 0), 0) / reachPosts.length) : 0
  const topReach = reachPosts.length > 0 ? Math.max(...reachPosts.map(p => p.reach ?? 0)) : 0
  const top3 = [...reachPosts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 3)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chart" size={15} color="var(--ad-blue)" />
          <span style={{ fontSize: 15, fontWeight: 700 }}>整體表現總覽</span>
        </div>
        <div className="ads-date-pill"><Icon name="calendar" size={12} />{data.overview.dateRange}</div>
      </div>

      <div className="ads-kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className={`ads-kpi-card ${k.color}`}>
            <button className="ads-kpi-ask-btn" onClick={() => onAskAI(k.q)}>?</button>
            <div className="ads-kpi-label">{k.label}</div>
            <div className="ads-kpi-value">{k.value}</div>
            <div className="ads-kpi-meta">
              <span>{k.meta}</span>
              {k.delta && <span className={`ads-kpi-delta ${k.dir}`}>{k.delta}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="ads-card ads-card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>月度預算進度</span>
          <span style={{ fontSize: 12, color: 'var(--ad-text3)', fontFamily: 'var(--font-dm-mono)' }}>{fmtK(s.spend)} / {fmtK(data.budget.total)}</span>
        </div>
        <div className="ads-budget-bar-wrap">
          <div className="ads-budget-bar-fill" style={{ width: `${budgetPct}%`, background: budgetPct > 95 ? 'var(--ad-orange)' : 'var(--ad-blue)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ad-text3)' }}>
          <span>{budgetPct.toFixed(1)}% 已使用</span>
          <span>剩餘 {fmtK(data.budget.remaining)} · 預計月底 {fmtK(data.budget.projectedSpend)}</span>
        </div>
      </div>

      <div className="ads-grid-2">
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>每日花費 vs 點擊數</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'clicks', label: '點擊數', color: '#3B6FD4', isCurr: true }, { key: 'spend', label: '花費', color: '#2E8B57', isCurr: true }]} />
        </div>
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{isVideoBased ? '每日觀看效益趨勢' : isClickBased ? '每日點擊效益趨勢' : '每日 CPL 趨勢'}</div>
          <SvgChart data={data.overview.dailySpend ?? []} height={170} lines={[{ key: 'roas', label: isClickBased ? '點擊效益' : 'CPL', color: '#3B6FD4' }]} roasTarget={s.roasTarget} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="calendar" size={15} color="var(--ad-blue)" />
          <span style={{ fontSize: 14, fontWeight: 700 }}>內容表現摘要</span>
          <span style={{ fontSize: 11.5, color: 'var(--ad-text3)' }}>過去 30 天 · {postsSource.length} 篇貼文</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: '最高觸及', value: String(topReach), sub: top3[0] ? `${top3[0].date} ${top3[0].type}` : '—', color: 'var(--ad-blue)' },
            { label: '平均觸及', value: String(avgReach), sub: '自然觸及', color: 'var(--ad-blue)' },
            { label: '平均互動率', value: reachPosts.length > 0 ? `${(reachPosts.reduce((acc, p) => acc + ((p.likes + p.comments + p.shares) / (p.reach ?? 1) * 100), 0) / reachPosts.length).toFixed(2)}%` : '—', sub: '(讚+留言+分享)/觸及', color: 'var(--ad-green)' },
            { label: '有廣告加持', value: `${adPosts.length} 篇`, sub: adPosts.length > 0 ? `最低 CPL $${Math.min(...adPosts.filter(p => (p.adCpa ?? 0) > 0).map(p => p.adCpa ?? 999)).toFixed(2)}` : '尚無廣告數據', color: 'var(--ad-orange)' },
          ].map(s => (
            <div key={s.label} className="ads-card ads-card-pad" style={{ borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ad-text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-dm-mono)', margin: '4px 0 2px', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--ad-text3)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div className="ads-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--ad-border)', fontSize: 12.5, fontWeight: 600, color: 'var(--ad-text2)' }}>🏆 觸及率 Top 3 貼文</div>
          {top3.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--ad-text3)', fontSize: 12.5 }}>暫無觸及資料</div>
          ) : top3.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < top3.length - 1 ? '1px solid var(--ad-border)' : 'none' }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'var(--ad-green)' : i === 1 ? 'var(--ad-blue)' : 'var(--ad-surface2)', color: i < 2 ? 'white' : 'var(--ad-text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ad-text3)', marginTop: 1 }}>{p.date} · {p.platform} · {p.type}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ad-blue)', fontFamily: 'var(--font-dm-mono)' }}>{fmt(p.reach ?? 0)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ad-text3)' }}>觸及</div>
              </div>
              {p.hasAd && p.adCpa != null && p.adCpa > 0 && <span className="ads-posts-ad-badge">🎯 CPL ${p.adCpa}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
