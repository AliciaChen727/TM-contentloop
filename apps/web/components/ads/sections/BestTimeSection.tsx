'use client'

import { Icon } from '../Icon'
import { SvgBarChart } from '../SvgCharts'
import type { AdData } from '../types'

export function BestTimeSection({ data }: { data: AdData }) {
  const maxRoas = Math.max(...data.bestTime.hourly.map(h => h.roas))
  const getColor = (r: number) => {
    const t = (r - 1) / (maxRoas - 1)
    return t > 0.8 ? '#3B6FD4' : t > 0.6 ? '#6B9AE8' : t > 0.4 ? '#A3BEF0' : t > 0.2 ? '#C2D4F5' : '#E8EFF9'
  }

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="clock" size={15} color="var(--ad-blue)" />
        <span className="ads-section-title">最佳投放時段分析</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ad-text3)' }}>過去 30 天平均 ROAS</span>
      </div>

      <div className="ads-grid-2">
        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>24 小時 ROAS 熱力圖</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {data.bestTime.hourly.map(h => (
              <div
                key={h.hour}
                title={`${h.hour}:00 — ROAS ${h.roas}`}
                style={{
                  width: 'calc(100%/8 - 4px)', height: 40,
                  background: getColor(h.roas), borderRadius: 5,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  transition: 'transform 0.1s', cursor: 'default',
                }}
                onMouseOver={e => (e.currentTarget.style.transform = 'scale(1.08)')}
                onMouseOut={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <div style={{ fontSize: 9, color: h.roas > 4 ? 'white' : '#9A9490', fontFamily: 'var(--font-dm-mono)' }}>{h.hour}:00</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: h.roas > 4 ? 'white' : '#1A1814', fontFamily: 'var(--font-dm-mono)' }}>{h.roas.toFixed(1)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--ad-text3)' }}>
            <span>低</span>
            {['#E8EFF9', '#C2D4F5', '#A3BEF0', '#6B9AE8', '#3B6FD4'].map((c, i) => (
              <div key={i} style={{ flex: 1, height: 7, borderRadius: 2, background: c }} />
            ))}
            <span>高 ROAS</span>
          </div>
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--ad-blue-light)', borderRadius: 7, fontSize: 12, color: 'var(--ad-blue)' }}>
            💡 <strong>黃金時段</strong>：19:00–21:00 ROAS 4.8–5.0，建議提升出價 20%
          </div>
        </div>

        <div className="ads-card ads-card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>週間 ROAS 表現</div>
          <SvgBarChart data={data.bestTime.weekly} dataKey="roas" labelKey="day" height={150} refLine={3.5} />
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--ad-green-light)', borderRadius: 7, fontSize: 12, color: 'var(--ad-green)' }}>
            💡 <strong>週四–週五</strong> ROAS 4.2–4.5 最佳，週日建議降預算 15%
          </div>
        </div>
      </div>
    </div>
  )
}
