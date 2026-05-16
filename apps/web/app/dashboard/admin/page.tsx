'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

interface UsageRow {
  uid: string
  email: string
  displayName: string
  imageCount: number
  imageCostUsd: number
  videoCount: number
  videoSeconds: number
  videoCostUsd: number
  totalCostUsd: number
}

function fmt(n: number) { return `$${n.toFixed(2)}` }

function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function currentMonth() { return new Date().toISOString().slice(0, 7) }

export default function AdminUsagePage() {
  const router = useRouter()
  const [idToken, setIdToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<UsageRow[]>([])
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.replace('/auth/login'); return }
      const token = await u.getIdToken()
      setIdToken(token)

      // Verify owner access
      const res = await fetch(`/api/admin/usage?month=${currentMonth()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) { router.replace('/dashboard'); return }
      const data = await res.json()
      setRows(data.rows ?? [])
      setLoading(false)
    })
    return unsub
  }, [router])

  async function loadMonth(m: string) {
    setFetching(true)
    const res = await fetch(`/api/admin/usage?month=${m}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    const data = await res.json()
    setRows(data.rows ?? [])
    setFetching(false)
  }

  function handlePrev() {
    const m = prevMonth(month)
    setMonth(m)
    loadMonth(m)
  }

  function handleNext() {
    const next = nextMonth(month)
    if (next > currentMonth()) return
    setMonth(next)
    loadMonth(next)
  }

  const totalImage = rows.reduce((s, r) => s + r.imageCostUsd, 0)
  const totalVideo = rows.reduce((s, r) => s + r.videoCostUsd, 0)
  const totalCost = rows.reduce((s, r) => s + r.totalCostUsd, 0)
  const totalImages = rows.reduce((s, r) => s + r.imageCount, 0)
  const totalVideoSec = rows.reduce((s, r) => s + r.videoSeconds, 0)

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-400">載入中⋯⋯</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-8 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600">← 返回</button>
          <h1 className="text-base font-bold text-gray-900">用量成本報表</h1>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-8 py-8">
        {/* Month switcher */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={handlePrev} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors">← 上月</button>
          <span className="text-sm font-semibold text-gray-800 min-w-[80px] text-center">{month}</span>
          <button
            onClick={handleNext}
            disabled={nextMonth(month) > currentMonth()}
            className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >下月 →</button>
          {fetching && <span className="text-xs text-gray-400">載入中⋯</span>}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">本月無用量記錄</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 font-medium">
                  <th className="text-left px-5 py-3">用戶</th>
                  <th className="text-right px-4 py-3">圖片張數</th>
                  <th className="text-right px-4 py-3">圖片成本</th>
                  <th className="text-right px-4 py-3">影片秒數</th>
                  <th className="text-right px-4 py-3">影片成本</th>
                  <th className="text-right px-5 py-3">合計</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.uid} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800">{r.displayName || r.email}</div>
                      {r.displayName && <div className="text-xs text-gray-400">{r.email}</div>}
                    </td>
                    <td className="text-right px-4 py-3 text-gray-600 font-mono">{r.imageCount} 張</td>
                    <td className="text-right px-4 py-3 text-gray-600 font-mono">{fmt(r.imageCostUsd)}</td>
                    <td className="text-right px-4 py-3 text-gray-600 font-mono">{r.videoSeconds} 秒</td>
                    <td className="text-right px-4 py-3 text-gray-600 font-mono">{fmt(r.videoCostUsd)}</td>
                    <td className="text-right px-5 py-3 font-semibold text-gray-800 font-mono">{fmt(r.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-gray-700">
                  <td className="px-5 py-3">合計</td>
                  <td className="text-right px-4 py-3 font-mono">{totalImages} 張</td>
                  <td className="text-right px-4 py-3 font-mono">{fmt(totalImage)}</td>
                  <td className="text-right px-4 py-3 font-mono">{totalVideoSec} 秒</td>
                  <td className="text-right px-4 py-3 font-mono">{fmt(totalVideo)}</td>
                  <td className="text-right px-5 py-3 font-mono text-blue-600">{fmt(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-400">成本以 Imagen 3 Fast $0.02/張、Veo 2 $0.50/秒計算</p>
      </div>
    </main>
  )
}
