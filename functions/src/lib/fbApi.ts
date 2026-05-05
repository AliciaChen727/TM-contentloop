const BASE = 'https://graph.facebook.com/v21.0'

export interface FbPost {
  id: string
  message?: string
  story?: string
  created_time: string
  permalink_url?: string
  reactions?: { summary: { total_count: number } }
  comments?: { summary: { total_count: number } }
  shares?: { count: number }
  engagementAvailable: boolean
}

async function fetchPosts(pageId: string, pageToken: string, fields: string): Promise<Omit<FbPost, 'engagementAvailable'>[]> {
  const url = new URL(`${BASE}/${pageId}/posts`)
  url.searchParams.set('access_token', pageToken)
  url.searchParams.set('fields', fields)
  url.searchParams.set('limit', '50')

  const res = await fetch(url)
  const data = await res.json() as { data?: Omit<FbPost, 'engagementAvailable'>[]; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'fetchPagePosts failed')
  return data.data ?? []
}

export async function fetchPagePosts(pageId: string, pageToken: string): Promise<FbPost[]> {
  const fullFields = 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares'
  const basicFields = 'id,message,story,created_time,permalink_url'

  try {
    const posts = await fetchPosts(pageId, pageToken, fullFields)
    return posts.map(p => ({ ...p, engagementAvailable: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('#10') || msg.includes('pages_read_engagement') || msg.includes('OAuthException')) {
      // Token 沒有 pages_read_engagement 權限，fallback 到基本欄位
      const posts = await fetchPosts(pageId, pageToken, basicFields)
      return posts.map(p => ({ ...p, engagementAvailable: false }))
    }
    throw err
  }
}
