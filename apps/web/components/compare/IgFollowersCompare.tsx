'use client'
// IG 粉絲樣貌比較 (Slice 17): account-level follower demographics from IG
// `follower_demographics` (age / gender / top cities). This is the ORGANIC
// audience — Meta has no per-post audience API; FB page demographics removed.
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Bucket { label: string; count: number }
export interface IgAudience { age: Bucket[]; gender: Bucket[]; city: Bucket[] }

const G_LABEL: Record<string, { zh: string; en: string }> = {
  F: { zh: '女', en: 'F' }, M: { zh: '男', en: 'M' }, U: { zh: '未知', en: '?' },
}

export function IgFollowersCompare({ pages }: { pages: { pageId: string; pageName: string; igAudience: IgAudience | null }[] }) {
  const { L, lang } = useLang()
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-gray-900">{L('IG 粉絲樣貌比較', 'IG Followers Comparison')}</h2>
      <p className="mb-3 mt-0.5 text-xs text-gray-400">{L('IG 帳號粉絲的年齡／性別／城市分佈（自然受眾，每日更新；FB 端已被 Meta 移除）', 'IG account follower age / gender / city (organic audience, daily; FB variant removed by Meta)')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {pages.map(p => {
          const a = p.igAudience
          if (!a || (a.age.length === 0 && a.gender.length === 0)) return (
            <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-1 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
              <div className="py-6 text-center text-xs text-gray-400">{L('尚無 IG 粉絲樣貌（需連動 IG 且粉絲數 ≥100，資料於每日同步後出現）', 'No IG follower data yet (requires linked IG with ≥100 followers; appears after daily sync)')}</div>
            </div>
          )
          const total = a.gender.reduce((s, g) => s + g.count, 0)
          const maxAge = Math.max(1, ...a.age.map(x => x.count))
          return (
            <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-2 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
              {total > 0 && (
                <div className="mb-2 text-xs text-gray-500">
                  {a.gender.map(g => `${G_LABEL[g.label]?.[lang === 'en' ? 'en' : 'zh'] ?? g.label} ${total > 0 ? Math.round(g.count / total * 100) : 0}%`).join('・')}
                </div>
              )}
              {a.age.slice(0, 6).map(x => (
                <div key={x.label} className="mb-1.5 last:mb-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{x.label}</span>
                    <span className="tabular-nums text-gray-400">{x.count.toLocaleString()}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded bg-gray-100">
                    <div className="h-1.5 rounded bg-emerald-400" style={{ width: `${Math.round(x.count / maxAge * 100)}%` }} />
                  </div>
                </div>
              ))}
              {a.city.length > 0 && (
                <div className="mt-2 text-xs text-gray-400">{L('主要城市', 'Top cities')}：{a.city.slice(0, 3).map(c => c.label).join('、')}</div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
