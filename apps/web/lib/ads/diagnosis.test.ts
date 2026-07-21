import { describe, it, expect } from 'vitest'
import type { DiagItem } from '@/components/ads/types'
import {
  inferStatus, inferCreativeType, inferThumb,
  mapRawAdCreative, buildDiagnosis, computeDiagnosisFromSnapshot, diagnosisToAlertItems,
} from './diagnosis'

const byId = (items: DiagItem[], id: string) => items.find(d => d.id === id)

describe('inferStatus — ROAS thresholds', () => {
  it.each([
    [4, 'top'], [4.1, 'top'],
    [3, 'good'], [3.99, 'good'],
    [1.5, 'ok'], [2.99, 'ok'],
    [1.49, 'bad'], [0, 'bad'],
  ] as const)('roas %f → %s', (roas, expected) => {
    expect(inferStatus(roas)).toBe(expected)
  })
})

describe('inferCreativeType / inferThumb', () => {
  it('classifies by name keyword (case-insensitive)', () => {
    expect(inferCreativeType('Summer REELS ad')).toBe('Reels')
    expect(inferCreativeType('story teaser')).toBe('Stories')
    expect(inferCreativeType('活動海報 v2')).toBe('海報')
    expect(inferCreativeType('一般貼文')).toBe('貼文')
  })
  it('maps type → thumb bucket', () => {
    expect(inferThumb('Reels')).toBe('reels')
    expect(inferThumb('Stories')).toBe('stories')
    expect(inferThumb('海報')).toBe('poster')
    expect(inferThumb('貼文')).toBe('post')
  })
})

describe('mapRawAdCreative', () => {
  it('uses real ROAS when purchases exist (revenue / spend)', () => {
    const c = mapRawAdCreative({
      ad_id: 'a1', ad_name: 'Promo', spend: '100', ctr: '2',
      actions: [{ action_type: 'purchase', value: '3' }],
      action_values: [{ action_type: 'purchase', value: '600' }],
    }, 0)
    expect(c.roas).toBe(6)         // 600 / 100
    expect(c.status).toBe('top')   // >= 4
  })
  it('falls back to click-efficiency for non-revenue accounts', () => {
    const c = mapRawAdCreative({
      ad_id: 'a2', ad_name: 'Traffic', spend: '50', ctr: '1',
      actions: [{ action_type: 'link_click', value: '10' }],
    }, 0)
    expect(c.roas).toBe(20)        // 10 / 50 * 100
  })
})

describe('buildDiagnosis — threshold rules', () => {
  it('frequency > 3.5 → critical audience_fatigue (d1)', () => {
    const d = byId(buildDiagnosis({ frequency: 4 }, [], 0), 'd1')
    expect(d?.severity).toBe('critical')
    expect(d?.type).toBe('audience_fatigue')
  })

  it('spend but zero conversions → warning (d2)', () => {
    const d = byId(buildDiagnosis({ spend: 100, conversions: 0, impressions: 500, ctr: 2 }, [], 0), 'd2')
    expect(d?.severity).toBe('warning')
  })

  it('budget spend 90% → warning; 96% → critical (d3)', () => {
    expect(byId(buildDiagnosis({ spend: 90, conversions: 5 }, [], 100), 'd3')?.severity).toBe('warning')
    expect(byId(buildDiagnosis({ spend: 96, conversions: 5 }, [], 100), 'd3')?.severity).toBe('critical')
  })

  it('budget spend 80% (boundary, not > 80) → no d3', () => {
    expect(byId(buildDiagnosis({ spend: 80, conversions: 5 }, [], 100), 'd3')).toBeUndefined()
  })

  it('low-CTR creative (>0 and <1.5, with spend) → warning (d4)', () => {
    const cr = mapRawAdCreative({ ad_id: 'x', ad_name: 'Low', spend: '100', ctr: '0.8', impressions: '1000' }, 0)
    expect(byId(buildDiagnosis({}, [cr], 0), 'd4')?.severity).toBe('warning')
  })

  it('top creative with click-efficiency >= 5 → good (d5)', () => {
    const cr = mapRawAdCreative({ ad_id: 'y', ad_name: 'Great', spend: '10', ctr: '3', actions: [{ action_type: 'link_click', value: '2' }] }, 0)
    // click efficiency = 2/10*100 = 20 (>= 5)
    expect(byId(buildDiagnosis({}, [cr], 0), 'd5')?.severity).toBe('good')
  })

  it('no delivery (spend & impressions both 0) → single "no data" good card (d0)', () => {
    const items = buildDiagnosis({ spend: 0, impressions: 0 }, [], 0)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('d0')
    expect(items[0].severity).toBe('good')
    expect(items[0].title).toContain('尚無廣告數據')
  })

  it('healthy account (activity, no issues) → "healthy" good card (d0)', () => {
    const items = buildDiagnosis({ spend: 50, impressions: 1000, ctr: 2, conversions: 5, frequency: 1 }, [], 0)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('d0')
    expect(items[0].title).toContain('帳戶表現良好')
  })

  it('English flag switches copy without changing severity', () => {
    const d = byId(buildDiagnosis({ frequency: 4 }, [], 0, true), 'd1')
    expect(d?.severity).toBe('critical')
    expect(d?.title).toBe('Audience fatigue warning')
  })
})

describe('computeDiagnosisFromSnapshot', () => {
  it('counts critical / warning from a stored snapshot', () => {
    const snap = { summary: { frequency: 4, spend: 90, conversions: 5, budget: 100 }, adCreatives: [] }
    const r = computeDiagnosisFromSnapshot(snap)
    expect(r.criticalCount).toBeGreaterThanOrEqual(1) // frequency 4
    expect(r.warningCount).toBeGreaterThanOrEqual(1)   // budget 90%
  })

  it('null snapshot degrades to a single good d0 card (0 critical / 0 warning)', () => {
    const r = computeDiagnosisFromSnapshot(null)
    expect(r.criticalCount).toBe(0)
    expect(r.warningCount).toBe(0)
  })
})

describe('diagnosisToAlertItems', () => {
  it('keeps only critical + warning, drops good', () => {
    const items = [
      { id: 'd1', severity: 'critical', type: 'audience_fatigue', title: 't', desc: 'd', adset: 'a', metric: 'm', threshold: 'x', action: 'go' },
      { id: 'd3', severity: 'warning', type: 'budget', title: 't', desc: 'd', adset: 'a', metric: 'm', threshold: 'x', action: 'go' },
      { id: 'd5', severity: 'good', type: 'top_performer', title: 't', desc: 'd', adset: 'a', metric: 'm', threshold: 'x', action: 'go' },
    ] as DiagItem[]
    const alerts = diagnosisToAlertItems(items)
    expect(alerts.map(a => a.severity)).toEqual(['critical', 'warning'])
    expect(alerts[0].key).toBe('audience_fatigue_d1')
  })
})
