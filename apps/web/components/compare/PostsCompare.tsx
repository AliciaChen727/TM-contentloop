'use client'
// 貼文比較 (Slice 17): organic post stats per page within the selected range,
// with a 30d / 90d / custom range selector (state owned by the parent page).
import { useLang } from '@/lib/i18n/LanguageProvider'

export interface PostStat { count: number; reach: number; engagement: number }
export interface TopPost { text: string; url: string; reach: number; engagement: number; platform: 'FB' | 'IG' }
export interface PagePosts { pageId: string; pageName: string; posts: { fb: PostStat; ig: PostStat; topPost: TopPost | null } }
export type RangeKey = '30d' | '90d' | 'custom'

const fmt = (n: number) => n.toLocaleString('zh-TW')

export function PostsCompare({ pages, from, to }: { pages: PagePosts[]; from: string; to: string }) {
  const { L } = useLang()
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">{L('貼文比較', 'Post Comparison')}</h2>
        <p className="mt-0.5 text-xs text-gray-400">{L('自然貼文（含 Reels）觸及與互動', 'Organic posts (incl. Reels) reach & engagement')}・{from} ~ {to}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {pages.map(p => {
          const total = p.posts.fb.count + p.posts.ig.count
          const reach = p.posts.fb.reach + p.posts.ig.reach
          const eng = p.posts.fb.engagement + p.posts.ig.engagement
          return (
            <div key={p.pageId} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-2 text-sm font-medium text-gray-900">{p.pageName || p.pageId}</div>
              {total === 0 ? (
                <div className="py-3 text-center text-xs text-gray-400">{L('此區間沒有貼文', 'No posts in this range')}</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-gray-50 py-2">
                      <div className="text-lg font-semibold tabular-nums">{total}</div>
                      <div className="text-xs text-gray-500">{L('貼文數', 'Posts')}（FB {p.posts.fb.count}・IG {p.posts.ig.count}）</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 py-2">
                      <div className="text-lg font-semibold tabular-nums">{fmt(reach)}</div>
                      <div className="text-xs text-gray-500">{L('總觸及', 'Reach')}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 py-2">
                      <div className="text-lg font-semibold tabular-nums">{fmt(eng)}</div>
                      <div className="text-xs text-gray-500">{L('總互動', 'Engagement')}</div>
                    </div>
                  </div>
                  {p.posts.topPost && (
                    <div className="mt-2 rounded-lg bg-purple-50/50 px-3 py-2 text-xs">
                      <span className="mr-1 rounded bg-white px-1 py-0.5 text-[10px] text-gray-500">{L('最佳', 'Top')} {p.posts.topPost.platform}</span>
                      {p.posts.topPost.url
                        ? <a href={p.posts.topPost.url} target="_blank" rel="noreferrer" className="text-purple-700 underline-offset-2 hover:underline">{p.posts.topPost.text || L('（無文字）', '(no text)')}</a>
                        : <span className="text-gray-700">{p.posts.topPost.text || L('（無文字）', '(no text)')}</span>}
                      <span className="ml-1 text-gray-400">{L('互動', 'eng.')} {fmt(p.posts.topPost.engagement)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
