'use client'

import { useEffect, useRef, useState } from 'react'

// Fully self-contained date field with an English ISO display and a custom
// English calendar popover. We avoid the native <input type="date"> entirely
// because Chrome localizes both its 年/月/日 placeholder AND the popup calendar
// from the browser's UI language, ignoring the page lang — so a custom calendar
// is the only way to guarantee English. Values are ISO 'YYYY-MM-DD' strings.

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function DateField({
  value, onChange, min, max, placeholder = 'YYYY-MM-DD', style,
}: {
  value: string
  onChange: (v: string) => void
  min?: string
  max?: string
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // Month currently shown in the popover (defaults to the value's month, else today).
  const initial = value ? value.split('-').map(Number) : []
  const today = new Date()
  const [viewY, setViewY] = useState(initial[0] || today.getFullYear())
  const [viewM, setViewM] = useState((initial[1] || today.getMonth() + 1) - 1) // 0-based

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const openCal = () => {
    const v = value ? value.split('-').map(Number) : []
    setViewY(v[0] || today.getFullYear())
    setViewM((v[1] || today.getMonth() + 1) - 1)
    setOpen(true)
  }

  const firstDow = new Date(viewY, viewM, 1).getDay()
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const disabled = (d: number): boolean => {
    const s = iso(viewY, viewM, d)
    return !!((min && s < min) || (max && s > max))
  }
  const prevMonth = () => { const m = viewM - 1; if (m < 0) { setViewM(11); setViewY(viewY - 1) } else setViewM(m) }
  const nextMonth = () => { const m = viewM + 1; if (m > 11) { setViewM(0); setViewY(viewY + 1) } else setViewM(m) }
  const pick = (d: number) => { if (disabled(d)) return; onChange(iso(viewY, viewM, d)); setOpen(false) }

  // Year range for the dropdown: honor min/max if given, else a sensible window.
  const nowY = today.getFullYear()
  const minY = min ? Number(min.slice(0, 4)) : nowY - 6
  const maxY = max ? Number(max.slice(0, 4)) : nowY + 1
  const years: number[] = []
  for (let y = Math.min(minY, viewY); y <= Math.max(maxY, viewY); y++) years.push(y)

  const navBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--ad-text2, #475569)', padding: '0 6px', lineHeight: 1 }
  const selStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 4px', background: '#fff', cursor: 'pointer' }

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <input
        type="text"
        readOnly
        value={value || ''}
        placeholder={placeholder}
        onClick={openCal}
        onFocus={openCal}
        style={{ width: '100%', cursor: 'pointer', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', padding: 0 }}
      />
      <span onClick={openCal} style={{ cursor: 'pointer', marginLeft: 6, fontSize: 13, lineHeight: 1, userSelect: 'none' }} aria-hidden>📅</span>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 1000, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 12, width: 252, fontFamily: 'var(--font-dm-sans, system-ui)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 4 }}>
            <button type="button" onClick={prevMonth} style={navBtn} aria-label="Previous month">‹</button>
            <div style={{ display: 'flex', gap: 4 }}>
              <select value={viewM} onChange={e => setViewM(Number(e.target.value))} style={selStyle} aria-label="Month">
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select value={viewY} onChange={e => setViewY(Number(e.target.value))} style={selStyle} aria-label="Year">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button type="button" onClick={nextMonth} style={navBtn} aria-label="Next month">›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>
            {WEEKDAYS.map(w => <div key={w} style={{ textAlign: 'center', padding: '2px 0' }}>{w}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} />
              const s = iso(viewY, viewM, d)
              const isSel = s === value
              const dis = disabled(d)
              return (
                <button
                  key={s}
                  type="button"
                  disabled={dis}
                  onClick={() => pick(d)}
                  style={{
                    height: 28, borderRadius: 6, border: 'none', fontSize: 12.5, cursor: dis ? 'not-allowed' : 'pointer',
                    background: isSel ? 'var(--ad-blue, #2563eb)' : 'transparent',
                    color: dis ? '#cbd5e1' : isSel ? '#fff' : '#1f2937',
                    fontWeight: isSel ? 700 : 400,
                  }}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
            <button type="button" onClick={() => { onChange(''); setOpen(false) }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>Clear</button>
            <button type="button" onClick={() => { const t = new Date(); const s = iso(t.getFullYear(), t.getMonth(), t.getDate()); if (!((min && s < min) || (max && s > max))) { onChange(s); setOpen(false) } }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>Today</button>
          </div>
        </div>
      )}
    </span>
  )
}
