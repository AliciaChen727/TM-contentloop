'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { SvgChart } from '@/components/ads/SvgCharts'

export interface PlatformStat {
  available: boolean
  error?: string
  conversations: number
  inboundMessages: number
  uniqueSenders: number
}
export interface DailyPoint { date: string; fbMsg: number; igMsg: number; fbUsers: number; igUsers: number }
export interface RecentItem { platform: 'IG' | 'FB'; name: string; lastTime: string | null; messageCount: number }
export interface MessagesData {
  totals: { conversations: number; inboundMessages: number; uniqueSenders: number }
  byPlatform: { IG: PlatformStat; FB: PlatformStat }
  daily: DailyPoint[]
  recent: RecentItem[]
  windowDays: number
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// Daily line/area chart — reuses the dashboard's SvgChart (Y-axis values, X-axis
// dates, hover tooltip). Two metric families: 則數 (message volume) + 人數 (unique
// senders), FB/IG each, toggleable via chips.
const yFmtInt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}K` : Math.round(v).toLocaleString('en-US'))

function DailyChart({ daily }: { daily: DailyPoint[] }) {
  const { L } = useLang()
  const metrics = [
    { key: 'fbMsg', label: L('FB 則數', 'FB msgs'), color: '#3B6FD4' },
    { key: 'igMsg', label: L('IG 則數', 'IG msgs'), color: '#EC4899' },
    { key: 'fbUsers', label: L('FB 人數', 'FB people'), color: '#2E8B57' },
    { key: 'igUsers', label: L('IG 人數', 'IG people'), color: '#C96A1A' },
  ]
  const [active, setActive] = useState<string[]>(metrics.map(m => m.key))
  const toggle = (k: string) =>
    setActive(prev => (prev.includes(k) ? (prev.length > 1 ? prev.filter(x => x !== k) : prev) : prev.concat(k)))

  // "YYYY-MM-DD" → "MM/DD" for compact x-axis labels (matches the dashboard).
  const chartData = daily.map(d => ({
    date: d.date.slice(5).replace('-', '/'),
    fbMsg: d.fbMsg, igMsg: d.igMsg, fbUsers: d.fbUsers, igUsers: d.igUsers,
  }))
  const lines = metrics.filter(m => active.includes(m.key)).map(m => ({ key: m.key, label: m.label, color: m.color, isInt: true }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {metrics.map(m => {
          const on = active.includes(m.key)
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={{
                borderColor: on ? m.color : '#e5e7eb',
                background: on ? `${m.color}18` : 'transparent',
                color: on ? m.color : '#9ca3af',
              }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: on ? m.color : '#e5e7eb' }} />
              {m.label}
            </button>
          )
        })}
      </div>
      {chartData.length >= 2 ? (
        <SvgChart data={chartData} lines={lines} height={200} yFmt={yFmtInt} />
      ) : (
        <p className="py-8 text-center text-sm text-gray-400">{L('資料點不足', 'Not enough data points')}</p>
      )}
    </div>
  )
}

export function MessageStats({ data }: { data: MessagesData }) {
  const { L } = useLang()
  const { totals, byPlatform, daily, recent } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={L('私訊則數', 'Inbound messages')} value={totals.inboundMessages} hint={L(`近 ${data.windowDays} 天內收到`, `received in last ${data.windowDays} days`)} />
        <StatCard label={L('對話數', 'Conversations')} value={totals.conversations} hint={L('IG + FB 合計', 'IG + FB combined')} />
        <StatCard label={L('發問人數', 'Unique senders')} value={totals.uniqueSenders} hint={L('不重複帳號', 'distinct accounts')} />
      </div>

      {/* Per-platform availability / breakdown */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(['IG', 'FB'] as const).map(pf => {
          const s = byPlatform[pf]
          const color = pf === 'IG' ? 'text-pink-500' : 'text-blue-600'
          return (
            <div key={pf} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className={`text-sm font-bold ${color}`}>{pf}</p>
              {s.available ? (
                <p className="mt-2 text-sm text-gray-600">
                  {L('私訊', 'Messages')} <strong>{s.inboundMessages}</strong> · {L('對話', 'Conv.')} <strong>{s.conversations}</strong> · {L('人數', 'Senders')} <strong>{s.uniqueSenders}</strong>
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-600">{L('無法讀取：', 'Unavailable: ')}{s.error ?? L('權限不足或無資料', 'no permission or no data')}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Daily chart */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-gray-700">{L(`每日私訊趨勢（近 ${data.windowDays} 天）`, `Daily trend (last ${data.windowDays} days)`)}</p>
        <p className="mb-3 text-xs text-gray-400">{L('則數＝當天訊息數；人數＝當天不重複發問人數', 'Msgs = messages that day; People = distinct senders that day')}</p>
        <DailyChart daily={daily} />
      </div>

      {/* Recent conversations */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-700">{L('最近對話', 'Recent conversations')}</p>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400">{L('目前沒有對話紀錄。', 'No conversations yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4 font-medium">{L('平台', 'Platform')}</th>
                  <th className="pb-2 pr-4 font-medium">{L('對象', 'From')}</th>
                  <th className="pb-2 pr-4 font-medium">
                    <span
                      className="cursor-help border-b border-dotted border-gray-300"
                      title={L('為整段對話往來總數（含雙向、全部時間），與上方每日趨勢的計法不同',
                               'Total messages exchanged in the whole conversation (both directions, all-time) — counted differently from the daily trend above')}
                    >
                      {L('累計訊息', 'Total msgs')} <span className="text-gray-300">ⓘ</span>
                    </span>
                  </th>
                  <th className="pb-2 font-medium">{L('最後互動', 'Last activity')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="py-2 pr-4">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.platform === 'IG' ? 'bg-pink-50 text-pink-600' : 'bg-blue-50 text-blue-600'}`}>{r.platform}</span>
                    </td>
                    <td className="py-2 pr-4 text-gray-800">{r.name || (r.platform === 'IG' ? L('Instagram 用戶', 'Instagram user') : L('Facebook 用戶', 'Facebook user'))}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.messageCount}</td>
                    <td className="py-2 text-gray-500">{r.lastTime ? new Date(r.lastTime).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
