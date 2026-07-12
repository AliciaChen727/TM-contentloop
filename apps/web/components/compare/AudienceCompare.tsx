'use client'
// 受眾樣貌比較 (Slice 17): top ad-audience segments per page, side by side.
// Data = age×gender ad breakdowns from each page's last synced ad window.
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface AudienceSeg { age: string; gender: string; spend: number; impressions: number; ctr: number }

const GENDER_LABEL: Record<string, { zh: string; en: string }> = {
  female: { zh: '女', en: 'F' }, male: { zh: '男', en: 'M' }, unknown: { zh: '未知', en: '?' },
}

export function AudienceCompare({ pages }: { pages: { pageId: string; pageName: string; audience: AudienceSeg[] }[] }) {
  const { L, lang } = useLang()
  const withData = pages
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-gray-900">{L('受眾樣貌比較', 'Audience Comparison')}</h2>
      <p className="mb-3 mt-0.5 text-xs text-gray-400">{L('依廣告投放的年齡×性別分佈（最近一次同步的投放期間，花費排序）', 'Ad delivery by age × gender (last synced ad window, sorted by spend)')}</p>
      {withData.length === 0 ? (
        <div className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">{L('尚無受眾數據（需有廣告投放）', 'No audience data yet (requires ad delivery)')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {withData.map(p => {
            if (p.audience.length === 0) return (
              <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-1 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
                <div className="py-6 text-center text-xs text-gray-400">{L('尚無受眾數據', 'No audience data yet')}</div>
              </div>
            )
            const maxSpend = Math.max(1, ...p.audience.map(a => a.spend))
            return (
              <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-3 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
                {p.audience.map((a, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{a.age}・{GENDER_LABEL[a.gender]?.[lang === 'en' ? 'en' : 'zh'] ?? a.gender}</span>
                      <span className="tabular-nums text-gray-400">${a.spend.toLocaleString()}｜CTR {a.ctr}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-gray-100">
                      <div className="h-1.5 rounded bg-purple-400" style={{ width: `${Math.round(a.spend / maxSpend * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
