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
  { key: 'reach',         label: '總觸擊',     color: '#3B6FD4', isInt: true,  disabled: false },
  { key: 'likes',         label: '總按讚',     color: '#2E8B57', isInt: true,  disabled: false },
  { key: 'comments',      label: '留言',       color: '#C96A1A', isInt: true,  disabled: false },
  { key: 'engRate',       label: '互動率%',    color: '#7C3AED', isInt: false, disabled: false },
  { key: 'followers',     label: '追蹤數',     color: '#E91E63', isInt: true,  disabled: true  },
  { key: 'followerGrowth',label: '追蹤成長率%',color: '#FF5722', isInt: false, disabled: true  },
]

const btnStyle = (active: boolean, color: string, disabled: boolean): React.CSSProperties => ({
  padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
  border: `1.5px solid ${active && !disabled ? color : 'var(--ad-border)'}`,
  background: active && !disabled ? color + '18' : 'transparent',
  color: active && !disabled ? color : 'var(--ad-text3)',
  display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.12s',
})

const dateInputStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 6, border: '1px solid var(--ad-border)',
  fontSize: 12, color: 'var(--ad-text2)', background: 'var(--ad-surface)',
  outline: 'none', cursor: 'pointer',
}

export function ContentChart({ data }: { data: DailyPoint[] }) {
  const [days, setDays] = useState(30)
  const [dateMode, setDateMode] = useState<'preset' | 'custom'>('preset')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [activeKeys, setActiveKeys] = useState<string[]>(['reach', 'likes'])

  const filtered = useMemo(() => {
    if (dateMode === 'custom' && customStart && customEnd) {
      return data.filter(d => d.fullDate >= customStart && d.fullDate <= customEnd)
    }
    if (!days || !data.length) return data
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return data.filter(d => d.fullDate >= cutoff.toISOString().slice(0, 10))
  }, [data, days, dateMode, customStart, customEnd])

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
    return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ad-text3)', fontSize: 13 }}>尚無資料</div>
  }

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Date presets */}
        <div style={{ display: 'flex', gap: 4 }}>
          {DATE_OPTS.map(opt => (
            <button
              key={opt.days}
              onClick={() => { setDateMode('preset'); setDays(opt.days) }}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: dateMode === 'preset' && days === opt.days ? '1px solid var(--ad-blue)' : '1px solid var(--ad-border)',
                background: dateMode === 'preset' && days === opt.days ? 'var(--ad-blue-light)' : 'var(--ad-surface)',
                color: dateMode === 'preset' && days === opt.days ? 'var(--ad-blue)' : 'var(--ad-text2)',
                transition: 'all 0.12s',
              }}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setDateMode('custom')}
            style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: dateMode === 'custom' ? '1px solid var(--ad-blue)' : '1px solid var(--ad-border)',
              background: dateMode === 'custom' ? 'var(--ad-blue-light)' : 'var(--ad-surface)',
              color: dateMode === 'custom' ? 'var(--ad-blue)' : 'var(--ad-text2)',
              transition: 'all 0.12s',
            }}
          >
            自訂
          </button>
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--ad-border)' }} />

        {/* Metric chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map(m => {
            const on = activeKeys.includes(m.key)
            return (
              <button
                key={m.key}
                onClick={() => !m.disabled && toggle(m.key)}
                style={btnStyle(on, m.color, m.disabled)}
                title={m.disabled ? '即將推出，需串接粉絲頁數據' : undefined}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: on && !m.disabled ? m.color : 'var(--ad-border)', display: 'inline-block', flexShrink: 0 }} />
                {m.label}
                {m.disabled && <span style={{ fontSize: 9, marginLeft: 2 }}>🔒</span>}
              </button>
            )
          })}
        </div>

        {activeKeys.includes('engRate') && (
          <span style={{ fontSize: 10.5, color: 'var(--ad-text3)', marginLeft: 'auto' }}>互動率 = (按讚+留言+分享) ÷ 觸擊</span>
        )}
      </div>

      {/* Custom date inputs */}
      {dateMode === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: 'var(--ad-text3)' }}>起始日期</span>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={dateInputStyle} />
          <span style={{ color: 'var(--ad-text3)' }}>至</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={dateInputStyle} />
          {customStart && customEnd && filtered.length === 0 && (
            <span style={{ color: 'var(--ad-orange)', fontSize: 11.5 }}>此區間無貼文資料</span>
          )}
        </div>
      )}

      {/* Chart */}
      {filtered.length >= 2 ? (
        <SvgChart data={filtered} lines={lines} height={180} yFmt={yFmt} />
      ) : (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ad-text3)', fontSize: 13 }}>
          {dateMode === 'custom' && (!customStart || !customEnd)
            ? '請選擇開始與結束日期'
            : '資料點不足，請選擇更長的日期區間'}
        </div>
      )}
    </div>
  )
}
