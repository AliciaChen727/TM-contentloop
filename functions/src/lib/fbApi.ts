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
}

export async function fetchPagePosts(pageId: string, pageToken: string): Promise<FbPost[]> {
  const url = new URL(`${BASE}/${pageId}/posts`)
  url.searchParams.set('access_token', pageToken)
  url.searchParams.set(
    'fields',
    'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares'
  )
  url.searchParams.set('limit', '50')

  const res = await fetch(url)
  const data = await res.json() as { data?: FbPost[]; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'fetchPagePosts failed')
  return data.data ?? []
}
