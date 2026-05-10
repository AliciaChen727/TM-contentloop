const BASE = 'https://graph.facebook.com/v19.0'

export interface PageToken {
  pageId: string
  pageName: string
  accessToken: string
  igUserId: string | null
}

export async function exchangeCodeForShortLived(code: string): Promise<string> {
  const url = new URL(`${BASE}/oauth/access_token`)
  url.searchParams.set('client_id', process.env.NEXT_PUBLIC_META_APP_ID!)
  url.searchParams.set('client_secret', process.env.META_APP_SECRET!)
  url.searchParams.set('redirect_uri', process.env.NEXT_PUBLIC_META_REDIRECT_URI!)
  url.searchParams.set('code', code)

  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'short-lived token failed')
  return data.access_token as string
}

export async function exchangeForLongLived(shortLivedToken: string): Promise<string> {
  const url = new URL(`${BASE}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', process.env.NEXT_PUBLIC_META_APP_ID!)
  url.searchParams.set('client_secret', process.env.META_APP_SECRET!)
  url.searchParams.set('fb_exchange_token', shortLivedToken)

  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'long-lived token failed')
  return data.access_token as string
}

export async function getAllManagedPages(userToken: string): Promise<PageToken[]> {
  const pageMap = new Map<string, PageToken>()
  const pageFields = 'id,name,access_token,instagram_business_account'

  // 1. Personal direct-admin pages
  const accRes = await fetch(`${BASE}/me/accounts?fields=${pageFields}&access_token=${userToken}`)
  const accData = await accRes.json()
  for (const p of (accData.data ?? []) as Record<string, unknown>[]) {
    const id = p.id as string
    pageMap.set(id, {
      pageId: id,
      pageName: p.name as string,
      accessToken: p.access_token as string,
      igUserId: (p.instagram_business_account as { id?: string } | undefined)?.id ?? null,
    })
  }

  // 2. Business Manager managed pages (requires business_management scope)
  try {
    const bizRes = await fetch(`${BASE}/me/businesses?fields=id,owned_pages{${pageFields}}&access_token=${userToken}`)
    const bizData = await bizRes.json()
    for (const biz of (bizData.data ?? []) as Record<string, unknown>[]) {
      const ownedPages = (biz.owned_pages as { data?: Record<string, unknown>[] } | undefined)?.data ?? []
      for (const p of ownedPages) {
        const id = p.id as string
        if (!pageMap.has(id)) {
          pageMap.set(id, {
            pageId: id,
            pageName: p.name as string,
            accessToken: p.access_token as string,
            igUserId: (p.instagram_business_account as { id?: string } | undefined)?.id ?? null,
          })
        }
      }
    }
  } catch {
    // business_management not granted — silently skip
  }

  return Array.from(pageMap.values())
}

export async function getPageTokenById(longLivedUserToken: string, pageIdentifier: string): Promise<PageToken> {
  const url = new URL(`${BASE}/${pageIdentifier}`)
  url.searchParams.set('access_token', longLivedUserToken)
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account')

  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'get page token failed')
  if (!data.access_token) throw new Error('Page access_token not returned. Check page admin role and permissions.')

  return {
    pageId: data.id,
    pageName: data.name,
    accessToken: data.access_token,
    igUserId: data.instagram_business_account?.id ?? null,
  }
}

export async function getPageToken(longLivedUserToken: string): Promise<PageToken> {
  const pageIdentifier = process.env.META_PAGE_IDENTIFIER
  if (!pageIdentifier) throw new Error('META_PAGE_IDENTIFIER not set in environment')

  // 直接用 Page username 或 ID 取 Page token，繞過 /me/accounts 的 Business Manager 限制
  const url = new URL(`${BASE}/${pageIdentifier}`)
  url.searchParams.set('access_token', longLivedUserToken)
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account')

  const res = await fetch(url)
  const data = await res.json()
  console.log('[getPageToken] direct page response:', JSON.stringify(data))

  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'get page token failed')
  if (!data.access_token) throw new Error('Page access_token not returned. Check page admin role and permissions.')

  return {
    pageId: data.id,
    pageName: data.name,
    accessToken: data.access_token,
    igUserId: data.instagram_business_account?.id ?? null,
  }
}
