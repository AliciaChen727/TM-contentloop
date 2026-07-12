'use client'
// Super-admin bug report list (Slice 18/19 pipeline) — shown on /dashboard/admin.
// Self-fetching; read-only. Fix flow lives on GitHub (Issue → Run workflow → PR).
import { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Bug {
  id: string
  source: string
  title: string
  summary: string
  severity: 'critical' | 'warning' | 'info'
  status: string
  count: number
  githubIssueUrl: string | null
  dateStr: string
}

const SEV: Record<string, { emoji: string; cls: string }> = {
  critical: { emoji: '🚨', cls: 'bg-red-50 text-red-600' },
  warning: { emoji: '⚠️', cls: 'bg-amber-50 text-amber-600' },
  info: { emoji: 'ℹ️', cls: 'bg-gray-100 text-gray-500' },
}

export function BugReportsCard() {
  const { L } = useLang()
  const [bugs, setBugs] = useState<Bug[] | null>(null)

  useEffect(() => {
    let alive = true
    async function run() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { if (alive) setBugs([]); return }
        const res = await fetch('/api/admin/bugs', { headers: { Authorization: `Bearer ${token}` } })
        const d = res.ok ? await res.json() : { bugs: [] }
        if (alive) setBugs(d.bugs ?? [])
      } catch { if (alive) setBugs([]) }
    }
    run()
    return () => { alive = false }
  }, [])

  if (bugs === null) return null

  return (
    <div className="mt-8 rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-1 text-sm font-bold text-gray-900">{L('AI Bug 回報', 'AI Bug Reports')}</div>
      <p className="mb-3 text-xs text-gray-400">
        {L('Agent 自動偵測的問題（最近 30 筆）。要修復：點 Issue → Actions → AI Bug Fix Agent → Run workflow → review PR。',
          'Auto-detected issues (latest 30). To fix: open the Issue → Actions → AI Bug Fix Agent → Run workflow → review the PR.')}
      </p>
      {bugs.length === 0 ? (
        <div className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
          {L('目前沒有 bug 回報 🎉', 'No bug reports 🎉')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                <th className="py-2 pr-3 font-medium">{L('日期', 'Date')}</th>
                <th className="py-2 pr-3 font-medium">{L('嚴重度', 'Severity')}</th>
                <th className="py-2 pr-3 font-medium">{L('摘要', 'Summary')}</th>
                <th className="py-2 pr-3 font-medium">{L('來源', 'Source')}</th>
                <th className="py-2 pr-3 font-medium text-right">{L('次數', 'Count')}</th>
                <th className="py-2 font-medium text-right">Issue</th>
              </tr>
            </thead>
            <tbody>
              {bugs.map(b => (
                <tr key={b.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 pr-3 text-xs text-gray-400">{b.dateStr}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${SEV[b.severity]?.cls ?? SEV.warning.cls}`}>
                      {SEV[b.severity]?.emoji ?? '⚠️'} {b.severity}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-700">{b.summary || b.title}</td>
                  <td className="py-2 pr-3"><code className="rounded bg-gray-50 px-1 text-xs text-gray-500">{b.source}</code></td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{b.count}</td>
                  <td className="py-2 text-right">
                    {b.githubIssueUrl
                      ? <a href={b.githubIssueUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline-offset-2 hover:underline">{L('開啟', 'Open')} ↗</a>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
