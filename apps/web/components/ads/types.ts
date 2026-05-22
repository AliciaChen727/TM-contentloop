export interface Post {
  id: string
  date: string
  platform: 'FB' | 'IG' | 'FB+IG'
  title: string
  reach: number | null
  likes: number
  comments: number
  saves: number | null
  shares: number
  plays: number | null
  type: 'post' | 'reels'
  url: string
  hasAd: boolean
  paidReach?: number
  organicReach?: number
  adRoas?: number
  adSpend?: number
  adCpa?: number
  adCtr?: number
}

export interface DailyData {
  [key: string]: number | string | undefined
  date: string
  spend: number
  revenue: number
  roas: number
  clicks?: number      // Link clicks (proxy for registrations)
  conversions?: number // Conversion events
}

export interface Creative {
  id: string
  name: string
  type: string
  channel: string
  spend: number
  roas: number
  ctr: number
  cpa: number
  impressions: number
  thumb: 'reels' | 'post' | 'stories' | 'poster'
  status: 'top' | 'good' | 'ok' | 'bad'
  linkClicks?: number
  cpc?: number
  adName?: string
}

export interface DiagItem {
  id: string
  severity: 'critical' | 'warning' | 'good'
  type: string
  title: string
  desc: string
  adset: string
  metric: string
  threshold: string
  action: string
}

export interface Adset {
  name: string
  budget: number
  spent: number
  roas: number
  cpa: number
}

export interface AdData {
  conversionType?: string
  overview: {
    dateRange: string
    summary: {
      spend: number
      budget: number
      roas: number
      roasTarget: number
      cpa: number
      cpaTarget: number
      ctr: number
      cpm: number
      reach: number
      impressions: number
      frequency: number
      conversions: number
      revenue: number
    }
    dailySpend: DailyData[]
    channelBreakdown: { channel: string; spend: number; pct: number; roas: number; cpa: number }[]
    contentBreakdown: { type: string; spend: number; roas: number; cpa: number; pct: number }[]
  }
  diagnosis: DiagItem[]
  creatives: Creative[]
  bestTime: {
    hourly: { hour: number; roas: number; spend: number }[]
    weekly: { day: string; roas: number; spend: number }[]
  }
  budget: {
    total: number
    spent: number
    remaining: number
    daysLeft: number
    dailyAvg: number
    projectedSpend: number
    adsets: Adset[]
  }
}

export type NavId = 'overview' | 'diagnosis' | 'creative' | 'posts' | 'time' | 'budget'
