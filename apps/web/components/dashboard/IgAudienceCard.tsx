'use client'
// IG 粉絲樣貌 card for the per-page content dashboard (below 成效趨勢).
// Self-fetching: GET /api/pages/ig-audience?pageId= (nightly-synced organic
// follower demographics from IG follower_demographics). Renders nothing while
// loading and a soft empty state when the page has no IG data yet.
import { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { useLang } from '@/lib/i18n/LanguageProvider'

interface Bucket { label: string; count: number }
interface IgAudience { age: Bucket[]; gender: Bucket[]; city: Bucket[] }

const G_LABEL: Record<string, { zh: string; en: string }> = {
  F: { zh: '女', en: 'F' }, M: { zh: '男', en: 'M' }, U: { zh: '未知', en: '?' },
}

export function IgAudienceCard({ pageId }: { pageId: string }) {
  const { L, lang } = useLang()
  const [data, setData] = useState<IgAudience | null | undefined>(undefined) // undefined = loading

  useEffect(() => {
    let alive = true
    async function run() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { if (alive) setData(null); return }
        const res = await fetch(`/api/pages/ig-audience?pageId=${pageId}`, { headers: { Authorization: `Bearer ${token}` } })
        const d = res.ok ? await res.json() : { igAudience: null }
        if (alive) setData(d.igAudience ?? null)
      } catch { if (alive) setData(null) }
    }
    if (pageId) run(); else setData(null)
    return () => { alive = false }
  }, [pageId])

  if (data === undefined) return null

  const total = data?.gender?.reduce((s, g) => s + g.count, 0) ?? 0
  const ages = data?.age?.slice(0, 6) ?? []
  const maxAge = Math.max(1, ...ages.map(x => x.count))

  return (
    <div className="ads-card ads-card-pad" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ad-text)', marginBottom: 4 }}>
        {L('IG 粉絲樣貌', 'IG Followers Profile')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ad-text2)', marginBottom: 12 }}>
        {L('IG 帳號粉絲的年齡／性別／城市分佈（自然受眾，每日更新）', 'IG follower age / gender / city (organic audience, updated daily)')}
      </div>
      {!data || ages.length === 0 ? (
        <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--ad-text2)' }}>
          {L('尚無 IG 粉絲樣貌（需連動 IG 且粉絲數 ≥100，資料於每日同步後出現）', 'No IG follower data yet (requires linked IG with ≥100 followers)')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            {ages.map(x => (
              <div key={x.label} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ad-text2)' }}>
                  <span>{x.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{x.count.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 3, height: 6, borderRadius: 3, background: '#F3F4F6' }}>
                  <div style={{ height: 6, borderRadius: 3, background: '#34D399', width: `${Math.round(x.count / maxAge * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: '0 1 200px', fontSize: 12.5, color: 'var(--ad-text2)' }}>
            {total > 0 && (
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--ad-text)' }}>{L('性別', 'Gender')}</span>：
                {(data.gender ?? []).map(g => `${G_LABEL[g.label]?.[lang === 'en' ? 'en' : 'zh'] ?? g.label} ${Math.round(g.count / total * 100)}%`).join('・')}
              </div>
            )}
            {(data.city?.length ?? 0) > 0 && (
              <div>
                <span style={{ fontWeight: 600, color: 'var(--ad-text)' }}>{L('主要城市', 'Top cities')}</span>：
                {data.city.slice(0, 3).map(c => c.label).join('、')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
