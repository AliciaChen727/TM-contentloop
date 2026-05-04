'use client'

import { useState, useMemo } from 'react'
import { SvgChart } from '@/components/ads/SvgCharts'

export interface DailyPoint {
  [key: string]: number | string
  date: string
  fullDate: string
  reach: number
  likes: number
  comments: number
  shares: number
  engRate: number
}

const DATE_OPTS = [
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
  { label: '全部', days: 0 },
]

const METRICS = [
  { key: 'reach', label: '總觸及', color: '#3B6FD4', isInt: true },
  { key: 'likes', label: '總按讚', color: '#2E8B57', isInt: true },
  { key: 'comments', label: '留言', color: '#C96A1A', isInt: true },
  { key: 'engRate', label: '互動率%', color: '#7C3AED', isInt: false },
]

export function ContentChart({ data }: { data: DailyPoint[] }) {
  const [days, setDays] = useState(30)
  const [activeKeys, setActiveKeys] = useState<string[]>(['reach', 'likes'])

  const filtered = useMemo(() => {
    if (!days || !data.length) return data
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return data.filter(d => d.fullDate >= cutoffStr)
  }, [data, days])

  const toggle = (key: string) => {
    setActiveKeys(prev => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter(k => k !== key) : prev
      // engRate uses a different scale — switch groups automatically
      const isRate = key === 'engRate'
      const prevHasRate = prev.includes('engRate')
      if (isRate && !prevHasRate) return [key]
      if (!isRate && prevHasRate) return [key]
      return [...prev, key]
    })
  }

  const lines = METRICS
    .filter(m => activeKeys.includes(m.key))
    .map(m => ({ key: m.key, label: m.label, color: m.color, isInt: m.isInt }))

  if (!data.length) {
    return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ad-text3)', fontSize: 13 }}>尚無資料</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {DATE_OPTS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: days === opt.days ? '1px solid var(--ad-blue)' : '1px solid var(--ad-border)',
                background: days === opt.days ? 'var(--ad-blue-light)' : 'var(--ad-surface)',
                color: days === opt.days ? 'var(--ad-blue)' : 'var(--ad-text2)',
                transition: 'all 0.12s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--ad-border)', margin: '0 2px' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map(m => {
            const on = activeKeys.includes(m.key)
            return (
              <button
                key={m.key}
                onClick={() => toggle(m.key)}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${on ? m.color : 'var(--ad-border)'}`,
                  background: on ? m.color + '18' : 'transparent',
                  color: on ? m.color : 'var(--ad-text3)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'all 0.12s',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? m.color : 'var(--ad-border)', display: 'inline-block', flexShrink: 0 }} />
                {m.label}
              </button>
            )
          })}
        </div>
        {activeKeys.includes('engRate') && activeKeys.length === 1 && (
          <span style={{ fontSize: 10.5, color: 'var(--ad-text3)', marginLeft: 'auto' }}>互動率 = (按讚+留言+分享) ÷ 觸及</span>
        )}
      </div>

      {filtered.length >= 2 ? (
        <SvgChart data={filtered} lines={lines} height={180} />
      ) : (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ad-text3)', fontSize: 13 }}>
          資料點不足，請選擇更長的日期區間
        </div>
      )}
    </div>
  )
}
