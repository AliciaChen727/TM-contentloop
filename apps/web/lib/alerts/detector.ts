// Ad performance anomaly detection. Runs on the latest adInsights snapshot after
// each daily sync. Pure function — no I/O — so it's easy to test and reuse.

export interface AdAlert {
  type: 'ctr_drop' | 'frequency_high' | 'cpc_spike'
  adName: string
  storyId: string | null
  value: number          // current value
  baseline: number       // benchmark / prior value
  changePercent: number  // signed % change vs baseline (for drop/spike)
  message: string        // ready-to-show zh-TW one-liner
  key: string            // stable id for dedup (type + ad)
}

interface DailyPoint { date: string; ctr?: number; spend?: number; clicks?: number; impressions?: number }
interface CreativeTrend { name?: string; storyId?: string | null; daily?: DailyPoint[] }
interface Snapshot {
  summary?: { frequency?: number }
  creativeTrends?: CreativeTrend[]
}

const RECENT_DAYS = 3
const MIN_DAYS = 5            // need at least this many days to judge a trend
const CTR_DROP_RATIO = 0.8   // recent < baseline * 0.8  → -20%+
const CPC_SPIKE_RATIO = 1.3  // recent > baseline * 1.3  → +30%+
const FREQ_THRESHOLD = 3.5

const avg = (nums: number[]): number => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0)

export function detectAdAlerts(snapshot: Snapshot): AdAlert[] {
  const alerts: AdAlert[] = []

  // 1) Account-level frequency (creative fatigue)
  const freq = snapshot.summary?.frequency ?? 0
  if (freq > FREQ_THRESHOLD) {
    alerts.push({
      type: 'frequency_high', adName: '整體帳戶', storyId: null,
      value: Number(freq.toFixed(2)), baseline: FREQ_THRESHOLD, changePercent: 0,
      message: `廣告頻率達 ${freq.toFixed(2)}（建議 < ${FREQ_THRESHOLD}），受眾可能已對素材疲乏`,
      key: 'frequency_high',
    })
  }

  // 2) Per-ad CTR drop & CPC spike (recent vs prior baseline)
  for (const ad of snapshot.creativeTrends ?? []) {
    const daily = (ad.daily ?? []).filter(d => (d.impressions ?? 0) > 0)
    if (daily.length < MIN_DAYS) continue
    const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1))
    const recent = sorted.slice(-RECENT_DAYS)
    const prior = sorted.slice(0, -RECENT_DAYS)
    if (prior.length === 0) continue

    const name = (ad.name ?? '廣告').slice(0, 40)

    // CTR drop
    const recentCtr = avg(recent.map(d => d.ctr ?? 0))
    const baseCtr = avg(prior.map(d => d.ctr ?? 0))
    if (baseCtr >= 0.5 && recentCtr < baseCtr * CTR_DROP_RATIO) {
      const drop = Math.round((baseCtr - recentCtr) / baseCtr * 100)
      alerts.push({
        type: 'ctr_drop', adName: name, storyId: ad.storyId ?? null,
        value: Number(recentCtr.toFixed(2)), baseline: Number(baseCtr.toFixed(2)), changePercent: -drop,
        message: `「${name}」CTR 下滑 ${drop}%（${baseCtr.toFixed(2)}% → ${recentCtr.toFixed(2)}%）`,
        key: `ctr_drop:${name}`,
      })
    }

    // CPC spike (cost per click = spend / clicks)
    const cpcOf = (pts: DailyPoint[]) => {
      const spend = pts.reduce((s, d) => s + (d.spend ?? 0), 0)
      const clicks = pts.reduce((s, d) => s + (d.clicks ?? 0), 0)
      return clicks > 0 ? spend / clicks : 0
    }
    const recentCpc = cpcOf(recent)
    const baseCpc = cpcOf(prior)
    if (baseCpc > 0 && recentCpc > baseCpc * CPC_SPIKE_RATIO) {
      const up = Math.round((recentCpc - baseCpc) / baseCpc * 100)
      alerts.push({
        type: 'cpc_spike', adName: name, storyId: ad.storyId ?? null,
        value: Number(recentCpc.toFixed(2)), baseline: Number(baseCpc.toFixed(2)), changePercent: up,
        message: `「${name}」CPC 飆升 ${up}%（$${baseCpc.toFixed(2)} → $${recentCpc.toFixed(2)}）`,
        key: `cpc_spike:${name}`,
      })
    }
  }

  return alerts
}
