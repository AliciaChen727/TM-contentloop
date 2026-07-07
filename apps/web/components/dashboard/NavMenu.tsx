'use client'

import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface NavItem {
  key: string
  icon: string        // emoji
  label: string
  onClick: () => void
  show: boolean       // permission gate
}

// Hamburger (三條線) menu that collapses the header's page-nav buttons into a
// single dropdown. Click-outside closes it (mirrors ProfileMenu). Hidden items
// (show=false) are dropped so viewers only see what they're allowed.
export function NavMenu({ items }: { items: NavItem[] }) {
  const { L } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const visible = items.filter(i => i.show)
  if (visible.length === 0) return null

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={L('功能選單', 'Menu')}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-purple-300 hover:text-purple-600"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {L('功能選單', 'Menu')}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-[100] w-52 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {visible.map(item => (
            <button
              key={item.key}
              onClick={() => { setOpen(false); item.onClick() }}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <span className="flex items-center gap-2"><span>{item.icon}</span>{item.label}</span>
              <span className="text-xs text-gray-400">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
