'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface TopIntent { key: string; label: string; count: number; samples?: string[] }

export function TopQuestions({ intents, loading, computedAt, onRefresh }: {
  intents: TopIntent[]
  loading: boolean
  computedAt?: number | null
  onRefresh?: () => void
}) {
  const { L } = useLang()
  const [open, setOpen] = useState<string | null>(null)
  const shown = intents.filter(i => i.count > 0).slice(0, 6)
  const max = Math.max(1, ...shown.map(i => i.count))
  const total = intents.reduce((s, i) => s + i.count, 0)

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{L('常見問題 Top', 'Top questions')}</p>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-gray-400">{L('AI 分析中…', 'Analyzing…')}</span>
          ) : (
            <>
              {computedAt && <span className="text-xs text-gray-300">{L('更新於 ', 'Updated ')}{new Date(computedAt).toLocaleString()}</span>}
              {onRefresh && (
                <button onClick={onRefresh} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-500 transition-colors hover:text-indigo-600">
                  {L('↻ 重新分析', '↻ Re-analyze')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-gray-400">{L('AI 將收到的私訊分類（結果快取，不會每次重算）；點任一列看範例訊息', 'AI classifies inbound messages (cached — not re-run every time); click a row to see examples')}</p>

      {!loading && shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">{L('尚無足夠私訊可分析', 'Not enough messages to analyze')}</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map(i => {
            const isOpen = open === i.key
            const hasSamples = (i.samples?.length ?? 0) > 0
            return (
              <div key={i.key}>
                <button
                  onClick={() => hasSamples && setOpen(isOpen ? null : i.key)}
                  className={`flex w-full items-center gap-3 rounded px-1 py-1 text-left ${hasSamples ? 'hover:bg-gray-50' : 'cursor-default'}`}
                >
                  <span className="flex w-28 shrink-0 items-center gap-1 truncate text-xs text-gray-600">
                    {hasSamples && <span className={`text-gray-300 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>}
                    {i.label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-gray-50">
                    <div className="h-full rounded bg-indigo-400" style={{ width: `${(i.count / max) * 100}%` }} />
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs text-gray-500">
                    {i.count}{total > 0 && <span className="text-gray-300"> · {Math.round((i.count / total) * 100)}%</span>}
                  </span>
                </button>
                {isOpen && hasSamples && (
                  <ul className="ml-6 mt-1 mb-2 space-y-1 border-l-2 border-gray-100 pl-3">
                    {i.samples!.map((s, idx) => (
                      <li key={idx} className="text-xs text-gray-500">「{s}」</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
