'use client'

import { useState } from 'react'
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
  followers: number
  followerGrowth: number
}

const METRICS = [
  { key: 'reach',          label: '總觸擊',      color: '#3B6FD4', isInt: true,  disabled: false },
  { key: 'likes',          label: '總按讚',      color: '#2E8B57', isInt: true,  disabled: false },
  { key: 'comments',       label: '留言',        color: '#C96A1A', isInt: true,  disabled: false },
  { key: 'engRate',        label: '互動率%',     color: '#7C3AED', isInt: false, disabled: false },
  { key: 'followers',      label: '追蹤數',      color: '#E91E63', isInt: true,  disabled: false },
  { key: 'followerGrowth', label: '追蹤成長率%', color: '#FF5722', isInt: false, disabled: false },
]

// data is already date-filtered by page.tsx
export function ContentChart({ data }: { data: DailyPoint[] }) {
  const [activeKeys, setActiveKeys] = useState<string[]>(['reach', 'likes'])

  const toggle = (key: string) => {
    setActiveKeys(prev => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter(k => k !== key) : prev
      const isRate = key === 'engRate' || key === 'followerGrowth'
      const prevHasRate = prev.some(k => k === 'engRate' || k === 'followerGrowth')
      if (isRate !== prevHasRate) return [key]
      return [...prev, key]
    })
  }

  const activeMetas = METRICS.filter(m => activeKeys.includes(m.key))
  const lines = activeMetas.map(m => ({ key: m.key, label: m.label, color: m.color, isInt: m.isInt }))
  const allInt = activeMetas.every(m => m.isInt)
  const yFmt = allInt
    ? (v: number) => Math.round(v) >= 10000 ? `${Math.round(Math.round(v) / 1000)}K` : Math.round(v).toLocaleString('zh-TW')
    : undefined

  if (!data.length) {
    return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ad-text3)', fontSize: 13 }}>此區間無貼文資料</div>
  }

  return (
    <div>
      {/* Metric chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {METRICS.map(m => {
          const on = activeKeys.includes(m.key)
          return (
            <button
              key={m.key}
              onClick={() => !m.disabled && toggle(m.key)}
              title={m.disabled ? '即將推出，需串接粉絲頁數據' : undefined}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                cursor: m.disabled ? 'not-allowed' : 'pointer', opacity: m.disabled ? 0.4 : 1,
                border: `1.5px solid ${on && !m.disabled ? m.color : 'var(--ad-border)'}`,
                background: on && !m.disabled ? m.color + '18' : 'transparent',
                color: on && !m.disabled ? m.color : 'var(--ad-text3)',
                display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.12s',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: on && !m.disabled ? m.color : 'var(--ad-border)', display: 'inline-block', flexShrink: 0 }} />
              {m.label}
              {m.disabled && <span style={{ fontSize: 9, marginLeft: 2 }}>🔒</span>}
            </button>
          )
        })}
        {activeKeys.includes('engRate') && (
          <span style={{ fontSize: 10.5, color: 'var(--ad-text3)', marginLeft: 'auto' }}>互動率 = (按讚+留言+分享) ÷ 觸擊</span>
        )}
      </div>

      {/* Chart */}
      {data.length >= 2 ? (
        <SvgChart data={data} lines={lines} height={180} yFmt={yFmt} />
      ) : (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ad-text3)', fontSize: 13 }}>
          資料點不足，請選擇更長的日期區間
        </div>
      )}
    </div>
  )
}
