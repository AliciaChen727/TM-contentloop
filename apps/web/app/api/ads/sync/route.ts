export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const BASE = 'https://graph.facebook.com/v19.0'

type MetaAction = { action_type: string; value: string }

function parseActions(actions: MetaAction[], type: string): number {
  return parseFloat(actions.find(a => a.action_type === type)?.value ?? '0')
}

export async function POST(req: NextRequest) {
  const idToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!idToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let uid: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const userRef = adminDb.collection('users').doc(uid)
  const tokenDoc = await userRef.collection('metaTokens').doc('page').get()
  if (!tokenDoc.exists) {
    return NextResponse.json({ error: 'No Meta token. Please reconnect.' }, { status: 400 })
  }

  const { userAccessToken } = tokenDoc.data() as { userAccessToken?: string }
  if (!userAccessToken) {
    return NextResponse.json({ error: 'No user access token. Please reconnect Meta to grant ads_read.' }, { status: 400 })
  }

  // Get ad accounts
  const accountsUrl = new URL(`${BASE}/me/adaccounts`)
  accountsUrl.searchParams.set('fields', 'id,name')
  accountsUrl.searchParams.set('access_token', userAccessToken)
  const accountsRes = await fetch(accountsUrl)
  const accountsData = await accountsRes.json()
  if (!accountsRes.ok || accountsData.error) {
    return NextResponse.json({ error: accountsData.error?.message ?? 'Failed to get ad accounts' }, { status: 500 })
  }
  const accounts: { id: string; name: string }[] = accountsData.data ?? []
  if (!accounts.length) {
    return NextResponse.json({ error: 'No ad accounts found under this user.' }, { status: 400 })
  }
  const adAccountId = accounts[0].id

  const insightFields = 'spend,reach,impressions,clicks,ctr,cpm,frequency,actions,action_values'

  // Fetch summary and daily in parallel
  const summaryUrl = new URL(`${BASE}/${adAccountId}/insights`)
  summaryUrl.searchParams.set('fields', insightFields)
  summaryUrl.searchParams.set('date_preset', 'last_30d')
  summaryUrl.searchParams.set('level', 'account')
  summaryUrl.searchParams.set('access_token', userAccessToken)

  const dailyUrl = new URL(`${BASE}/${adAccountId}/insights`)
  dailyUrl.searchParams.set('fields', insightFields)
  dailyUrl.searchParams.set('date_preset', 'last_30d')
  dailyUrl.searchParams.set('time_increment', '1')
  dailyUrl.searchParams.set('level', 'account')
  dailyUrl.searchParams.set('access_token', userAccessToken)

  const [summaryRes, dailyRes] = await Promise.all([fetch(summaryUrl), fetch(dailyUrl)])
  const [summaryData, dailyData] = await Promise.all([summaryRes.json(), dailyRes.json()])

  if (!summaryRes.ok || summaryData.error) {
    return NextResponse.json({ error: summaryData.error?.message ?? 'Failed to get insights' }, { status: 500 })
  }

  // Parse summary
  const s = summaryData.data?.[0] ?? {}
  const spend = parseFloat(s.spend ?? '0')
  const reach = parseInt(s.reach ?? '0')
  const impressions = parseInt(s.impressions ?? '0')
  const clicks = parseInt(s.clicks ?? '0')
  const ctr = parseFloat(s.ctr ?? '0')
  const cpm = parseFloat(s.cpm ?? '0')
  const frequency = parseFloat(s.frequency ?? '0')

  const sActions: MetaAction[] = s.actions ?? []
  const sActionValues: MetaAction[] = s.action_values ?? []

  // Determine conversion type: prefer purchase, fallback to video_view
  const hasPurchase = sActions.some(a => a.action_type === 'purchase')
  const conversionType = hasPurchase ? 'purchase' : 'video_view'
  const conversions = parseActions(sActions, conversionType)
  const revenue = parseActions(sActionValues, 'purchase')
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0
  const cpa = conversions > 0 ? spend / conversions : 0

  // Parse daily
  const rawDaily: Record<string, unknown>[] = dailyData.data ?? []
  const daily = rawDaily.map(d => {
    const daySpend = parseFloat((d.spend as string) ?? '0')
    const dayActions: MetaAction[] = (d.actions as MetaAction[]) ?? []
    const dayActionValues: MetaAction[] = (d.action_values as MetaAction[]) ?? []
    const dayConversions = parseActions(dayActions, conversionType)
    const dayRevenue = parseActions(dayActionValues, 'purchase')
    return {
      date: d.date_start as string,
      spend: daySpend,
      reach: parseInt((d.reach as string) ?? '0'),
      impressions: parseInt((d.impressions as string) ?? '0'),
      clicks: parseInt((d.clicks as string) ?? '0'),
      ctr: parseFloat((d.ctr as string) ?? '0'),
      roas: daySpend > 0 && dayRevenue > 0 ? dayRevenue / daySpend : 0,
      conversions: dayConversions,
      revenue: dayRevenue,
    }
  })

  const dateFrom = daily[0]?.date ?? ''
  const dateTo = daily[daily.length - 1]?.date ?? ''

  await userRef.collection('adInsights').doc('latest').set({
    syncedAt: Timestamp.now(),
    dateRange: { from: dateFrom, to: dateTo },
    adAccountId,
    conversionType,
    summary: { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa },
    daily,
  })

  return NextResponse.json({ success: true, adAccountId, spend, conversions, conversionType })
}
