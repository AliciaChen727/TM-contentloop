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
  campaignName?: string
  budget?: number
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
  id?: string
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
  creativeTrends?: CreativeTrend[]
  demographics?: DemoBreakdown[]
  platformBreakdown?: PlatformBreakdown[]
  funnelStages?: FunnelStage[]
}

export interface PlatformBreakdown {
  platform: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
  revenue: number
}

export interface DemoBreakdown {
  age: string
  gender: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
  revenue: number
}

export interface FunnelStage {
  stage: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
  revenue: number
}

export interface CreativeTrendDaily {
  date: string
  spend: number
  reach: number
  impressions: number
  clicks: number
  ctr: number
  conversions: number
  revenue: number
  roas: number
}

export interface CreativeTrend {
  adId: string
  name: string
  thumbnailUrl: string | null
  storyId: string | null
  daily: CreativeTrendDaily[]
}

export type NavId = 'overview' | 'insights' | 'diagnosis' | 'creative' | 'posts' | 'time' | 'budget' | 'trends' | 'audience'

export type Variant = 'A' | 'B' | 'control'

export interface LabelEntry {
  variant: Variant
  experimentId: string
}

export interface Experiment {
  id: string
  name: string
  aiDiagnosis: string
  winner: string
  ctrDelta?: number | null
  cpaDelta?: number | null
}
