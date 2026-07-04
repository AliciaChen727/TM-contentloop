'use client'

import { useLang } from '@/lib/i18n/LanguageProvider'

export interface PlatformStat {
  available: boolean
  error?: string
  conversations: number
  inboundMessages: number
  uniqueSenders: number
}
export interface DailyPoint { date: string; ig: number; fb: number }
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

// Lightweight inline bar chart (no external chart lib) — IG + FB stacked per day.
function DailyBars({ daily }: { daily: DailyPoint[] }) {
  const max = Math.max(1, ...daily.map(d => d.ig + d.fb))
  return (
    <div className="flex h-40 items-end gap-[2px]">
      {daily.map(d => {
        const total = d.ig + d.fb
        const h = (total / max) * 100
        const igH = total > 0 ? (d.ig / total) * 100 : 0
        return (
          <div key={d.date} className="group relative flex-1" style={{ height: '100%' }} title={`${d.date}: IG ${d.ig} · FB ${d.fb}`}>
            <div className="absolute bottom-0 w-full overflow-hidden rounded-t-sm" style={{ height: `${h}%` }}>
              <div className="w-full bg-pink-400" style={{ height: `${igH}%` }} />
              <div className="w-full bg-blue-500" style={{ height: `${100 - igH}%` }} />
            </div>
          </div>
        )
      })}
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
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{L(`每日私訊量（近 ${data.windowDays} 天）`, `Daily inbound (last ${data.windowDays} days)`)}</p>
          <div className="flex gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-pink-400" />IG</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />FB</span>
          </div>
        </div>
        <DailyBars daily={daily} />
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
                  <th className="pb-2 pr-4 font-medium">{L('訊息數', 'Messages')}</th>
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
