'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import type { AdData, Variant, LabelEntry, Experiment } from '../types'
import { useLang } from '@/lib/i18n/LanguageProvider'
import { useHistoricalCreatives } from '@/lib/ads/useHistoricalCreatives'

const fmtK = (n: number) => n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`
const statusLabel = (s: string, en: boolean): string => en
  ? ({ top: '🏆 Top', good: '👍 Good', ok: 'OK', bad: '⚠️ Needs work' }[s] ?? s)
  : ({ top: '🏆 最佳', good: '👍 良好', ok: '一般', bad: '⚠️ 待優' }[s] ?? s)
const statusLabelText = (s: string, en: boolean): string => en
  ? ({ top: 'Top', good: 'Good', ok: 'OK', bad: 'Needs work' }[s] ?? s)
  : ({ top: '最佳', good: '良好', ok: '一般', bad: '待優' }[s] ?? s)
const TYPES = ['全部', 'Reels', '貼文', 'Stories', '海報']
const typeLabel = (t: string, en: boolean): string => en
  ? ({ '全部': 'All', '貼文': 'Post', 'Stories': 'Stories', '海報': 'Poster', 'Reels': 'Reels' }[t] ?? t)
  : t
type SortBy = 'roas' | 'spend' | 'cpa'
type WinnerType = 'pending' | 'A' | 'B' | 'inconclusive'

const winnerOptions = (en: boolean): { value: WinnerType; label: string }[] => [
  { value: 'pending', label: en ? 'No conclusion yet' : '尚未得出結論' },
  { value: 'A', label: en ? 'A wins' : 'A 組勝出' },
  { value: 'B', label: en ? 'B wins' : 'B 組勝出' },
  { value: 'inconclusive', label: en ? 'No significant difference' : '無顯著差異' },
]

const VARIANT_STYLE: Record<Variant, { bg: string; color: string; label: string; labelEn: string }> = {
  control: { bg: '#f1f5f9', color: '#475569', label: '控制組', labelEn: 'Control' },
  A: { bg: '#dbeafe', color: '#1d4ed8', label: 'A 版', labelEn: 'A' },
  B: { bg: '#ffedd5', color: '#c2410c', label: 'B 版', labelEn: 'B' },
}
const variantLabel = (v: Variant, en: boolean): string => en ? VARIANT_STYLE[v].labelEn : VARIANT_STYLE[v].label

type ExperimentUpdate = { name?: string; aiDiagnosis?: string; winner?: string; ctrDelta?: number; cpaDelta?: number }

function buildCreativePrompt(c: AdData['creatives'][number], en: boolean): string {
  if (en) {
    return `Please analyze this ad creative:\n"${c.name}"\nType: ${c.type} | Channel: ${c.channel} | Status: ${statusLabelText(c.status, true)}\nCPC: $${(c.cpc ?? c.cpa).toFixed(2)} | Click value: ${c.roas.toFixed(1)}x | Spend: $${c.spend} | CTR: ${Number(c.ctr).toFixed(2)}% | Impressions: ${c.impressions.toLocaleString()}\n\nPlease give a performance diagnosis and specific optimization suggestions for this creative.`
  }
  return `請分析這個廣告素材：\n《${c.name}》\n類型：${c.type}｜頻道：${c.channel}｜狀態：${statusLabelText(c.status, false)}\nCPC：$${(c.cpc ?? c.cpa).toFixed(2)}｜點擊效益：${c.roas.toFixed(1)}x｜花費：$${c.spend}｜CTR：${Number(c.ctr).toFixed(2)}%｜曝光：${c.impressions.toLocaleString()}\n\n請給出這個素材的成效診斷和具體優化建議。`
}

const PlatformIcon = ({ type }: { type: 'IG' | 'FB' }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 5px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    marginRight: 6,
    verticalAlign: 'text-bottom',
    ...(type === 'IG'
      ? { background: '#fce4ec', color: '#c2185b' }
      : { background: '#e3f2fd', color: '#1976d2' })
  }}>
    {type}
  </span>
)

function renderAdName(name: string) {
  let isIg = false
  let cleanName = name

  if (/^Instagram (post|貼文)[:：\s]*/i.test(name)) {
    isIg = true
    cleanName = name.replace(/^Instagram (post|貼文)[:：\s]*/i, '')
  } else if (/Instagram/i.test(name)) {
    isIg = true
  }

  return (
    <>
      <PlatformIcon type={isIg ? 'IG' : 'FB'} />
      {cleanName}
    </>
  )
}

// Two-step badge: first pick (or create) an experiment, then pick the variant.
// An ad belongs to exactly one experiment, so the badge shows "{experiment}·{variant}".
function ExperimentBadge({ adId, label, experiments, onLabelChange, onCreateExperiment, onExperimentUpdate }: {
  adId: string
  label: LabelEntry | undefined
  experiments: Experiment[]
  onLabelChange: (adId: string, variant: Variant | null, experimentId?: string) => void
  onCreateExperiment: (name: string) => Promise<string>
  onExperimentUpdate?: (experimentId: string, update: ExperimentUpdate) => void
}) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [open, setOpen] = useState(false)
  const [selectedExp, setSelectedExp] = useState<string>(label?.experimentId ?? '')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string>('')
  const [editName, setEditName] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 360 })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function saveRename(id: string) {
    const name = editName.trim()
    if (name && onExperimentUpdate) onExperimentUpdate(id, { name })
    setEditingId('')
    setEditName('')
  }

  function openMenu() {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) {
      const WIDTH = 200
      const GAP = 4
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow
      const maxHeight = Math.min(360, openUp ? spaceAbove : spaceBelow)
      const left = Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8))
      const top = openUp ? Math.max(8, rect.top - GAP - maxHeight) : rect.bottom + GAP
      setCoords({ top, left, maxHeight })
    }
    setOpen(true)
  }

  useEffect(() => { setSelectedExp(label?.experimentId ?? '') }, [label?.experimentId])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false); setCreating(false)
    }
    function handleClose() { setOpen(false); setCreating(false) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
    }
  }, [open])

  const currentExp = experiments.find(e => e.id === label?.experimentId)
  const badgeText = label
    ? `${currentExp?.name || (en ? 'Experiment' : '實驗')}·${variantLabel(label.variant, en)}`
    : (en ? '＋ Tag' : '＋ 標記')

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const id = await onCreateExperiment(name)
    if (id) { setSelectedExp(id); setCreating(false); setNewName('') }
  }

  function pickVariant(v: Variant) {
    if (!selectedExp) return
    onLabelChange(adId, v, selectedExp)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { if (open) { setOpen(false); setCreating(false) } else openMenu() }}
        title={L('設定 A/B 測試標籤', 'Set A/B test label')}
        style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: 'none',
          maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          ...(label ? { background: VARIANT_STYLE[label.variant].bg, color: VARIANT_STYLE[label.variant].color } : { background: '#f1f5f9', color: '#94a3b8' }),
          fontFamily: 'inherit',
        }}
      >
        {badgeText}
      </button>
      {open && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: coords.top, left: coords.left, width: 200, maxHeight: coords.maxHeight, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 1000, padding: '6px 0' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{L('實驗', 'Experiment')}</div>
          {experiments.length === 0 && !creating && (
            <div style={{ padding: '4px 12px', fontSize: 11, color: '#cbd5e1' }}>{L('尚無實驗，請新增', 'No experiments yet — add one')}</div>
          )}
          {experiments.map(e => (
            editingId === e.id ? (
              <div key={e.id} style={{ display: 'flex', gap: 4, padding: '6px 12px', boxSizing: 'border-box' }}>
                <input
                  autoFocus
                  value={editName}
                  onChange={ev => setEditName(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === 'Enter') saveRename(e.id) }}
                  onBlur={() => saveRename(e.id)}
                  style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 6px', border: '1px solid #bfdbfe', borderRadius: 6, fontFamily: 'inherit' }}
                />
                <button onClick={() => saveRename(e.id)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>{L('確認', 'OK')}</button>
              </div>
            ) : (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedExp(e.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, textAlign: 'left', padding: '7px 12px', fontSize: 12,
                    background: selectedExp === e.id ? '#eff6ff' : 'none', border: 'none', cursor: 'pointer',
                    color: selectedExp === e.id ? '#1d4ed8' : '#1e293b', fontWeight: selectedExp === e.id ? 600 : 400, fontFamily: 'inherit',
                  }}
                >
                  <span style={{ width: 8 }}>{selectedExp === e.id ? '✓' : ''}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || L('(未命名)', '(untitled)')}</span>
                </button>
                {onExperimentUpdate && (
                  <button
                    onClick={() => { setEditingId(e.id); setEditName(e.name || '') }}
                    title={L('重新命名', 'Rename')}
                    style={{ padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontFamily: 'inherit' }}
                  >
                    ✎
                  </button>
                )}
              </div>
            )
          ))}
          {creating ? (
            <div style={{ display: 'flex', gap: 4, padding: '6px 12px' }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder={L('實驗名稱', 'Experiment name')}
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 6px', border: '1px solid #bfdbfe', borderRadius: 6, fontFamily: 'inherit' }}
              />
              <button onClick={handleCreate} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>{L('確認', 'OK')}</button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', fontWeight: 600, fontFamily: 'inherit' }}
            >
              {L('＋ 新增實驗', '＋ New experiment')}
            </button>
          )}

          <div style={{ borderTop: '1px solid #f1f5f9', margin: '6px 0' }} />
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{L('版本', 'Variant')}</div>
          {(['control', 'A', 'B'] as Variant[]).map(v => (
            <button
              key={v}
              disabled={!selectedExp}
              onClick={() => pickVariant(v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12,
                background: label?.variant === v && label?.experimentId === selectedExp ? '#f8fafc' : 'none', border: 'none',
                cursor: selectedExp ? 'pointer' : 'not-allowed', color: selectedExp ? '#1e293b' : '#cbd5e1', fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: VARIANT_STYLE[v].bg, border: `1px solid ${VARIANT_STYLE[v].color}` }} />
              {variantLabel(v, en)}
            </button>
          ))}

          {label && (
            <>
              <div style={{ borderTop: '1px solid #f1f5f9', margin: '6px 0' }} />
              <button
                onClick={() => { onLabelChange(adId, null); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontFamily: 'inherit' }}
              >
                {L('清除標籤', 'Clear label')}
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function pct(val: number, base: number): string {
  if (base === 0) return '—'
  const d = ((val - base) / base) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(0)}%`
}

function pctColor(val: number, base: number, higherIsBetter: boolean): string {
  if (base === 0) return '#64748b'
  const improved = higherIsBetter ? val > base : val < base
  return improved ? '#16a34a' : '#dc2626'
}

interface GroupStats { ctr: number; cpa: number; roas: number; totalSpend: number; totalImpr: number; count: number }

function calcGroupStats(creatives: AdData['creatives']): GroupStats {
  if (creatives.length === 0) return { ctr: 0, cpa: 0, roas: 0, totalSpend: 0, totalImpr: 0, count: 0 }
  let totalSpend = 0, totalImpr = 0, wCtr = 0, wCpa = 0, wRoas = 0
  for (const c of creatives) {
    totalSpend += c.spend
    totalImpr += c.impressions ?? 0
    wCtr += Number(c.ctr) * c.spend
    wCpa += c.cpa * c.spend
    wRoas += c.roas * c.spend
  }
  const s = totalSpend || 1
  return { ctr: wCtr / s, cpa: wCpa / s, roas: wRoas / s, totalSpend, totalImpr, count: creatives.length }
}

type AbDiagnosis = {
  pattern: string | null
  roiWinner: 'A' | 'B' | 'control' | 'inconclusive'
  interpretation: string
  actions: string[]
}

function buildAbDiagnosis(
  baseStats: GroupStats,
  testStats: GroupStats,
  testLabel: 'A' | 'B',
  hasControl: boolean,
  winner: WinnerType,
  en: boolean
): AbDiagnosis {
  const ctrDelta = baseStats.ctr > 0 ? (testStats.ctr - baseStats.ctr) / baseStats.ctr : 0
  const roasDelta = baseStats.roas > 0 ? (testStats.roas - baseStats.roas) / baseStats.roas : 0
  const baseLabel = en ? (hasControl ? 'Control' : 'A') : (hasControl ? '控制組' : 'A 版')
  const v = testLabel
  const vl = en ? `${v}` : `${v} 版`

  const imprBase = Math.max(baseStats.totalImpr, testStats.totalImpr)
  const spendBase = Math.max(baseStats.totalSpend, testStats.totalSpend)
  const imprGap = imprBase > 0 ? Math.abs(testStats.totalImpr - baseStats.totalImpr) / imprBase : 0
  const spendGap = spendBase > 0 ? Math.abs(testStats.totalSpend - baseStats.totalSpend) / spendBase : 0
  const spendDiff = Math.abs(testStats.totalSpend - baseStats.totalSpend)
  const imbalanced = imprGap > 0.30 || spendGap > 0.25
  const imbalanceDesc = en
    ? `impressions differ by ${(imprGap * 100).toFixed(0)}%, spend by ${fmtK(spendDiff)}`
    : `曝光差 ${(imprGap * 100).toFixed(0)}%、花費差 ${fmtK(spendDiff)}`

  const ctrPct = ctrDelta * 100
  const ctrPhrase = Math.abs(ctrPct) >= 3
    ? (en
        ? `${vl} CTR is ${ctrPct >= 0 ? 'higher' : 'lower'} than ${baseLabel} by ${Math.abs(ctrPct).toFixed(0)}%`
        : `${vl} CTR ${ctrPct >= 0 ? '高出' : '低於'}${baseLabel} ${Math.abs(ctrPct).toFixed(0)}%`)
    : (en ? `${vl} CTR is close to ${baseLabel}` : `${vl} CTR 與${baseLabel}相近`)

  // 1) Manual winner declared → delivery ended, announce result.
  if (winner === 'A' || winner === 'B') {
    const wl = en ? `${winner}` : `${winner} 版`
    const roiPhrase = en
      ? (roasDelta > 0.02 ? 'with better click value' : roasDelta < -0.02 ? 'with slightly lower click value' : 'with comparable click value')
      : (roasDelta > 0.02 ? '點擊效益更佳' : roasDelta < -0.02 ? '點擊效益略低' : '點擊效益與其相當')
    const balanceNote = en
      ? (imbalanced ? ` (note: the two groups' delivery conditions differ somewhat — ${imbalanceDesc})` : ', and the two groups had similar delivery conditions, so it is reliable')
      : (imbalanced ? `（兩組投放條件略有落差：${imbalanceDesc}，判讀時宜留意）` : '，且兩組投放條件相近、具參考價值')
    return {
      pattern: en ? 'Winner' : '勝出版本',
      roiWinner: winner,
      interpretation: en
        ? `Delivery has ended; ${wl} is confirmed as the winner. ${ctrPhrase}, ${roiPhrase}${balanceNote}. Use ${wl} as the baseline creative for similar future ads.`
        : `投放已結束，確認由 ${wl}勝出。${ctrPhrase}，${roiPhrase}${balanceNote}。建議將 ${wl}素材作為後續同類廣告的基準版本。`,
      actions: en
        ? [`Use ${wl} as the baseline creative for similar future ads`, `Record how ${wl} differs from ${baseLabel} (copy, visual, CTA) and carry it into the next campaign`]
        : [`以 ${wl}素材作為後續同類廣告的基準版本`, `記錄 ${wl}相對${baseLabel}的差異（文案、視覺、CTA），沿用到下一檔活動`],
    }
  }

  // 2) Explicitly inconclusive.
  if (winner === 'inconclusive') {
    return {
      pattern: null,
      roiWinner: 'inconclusive',
      interpretation: imbalanced
        ? (en ? `The two groups' delivery conditions are unequal (${imbalanceDesc}), so there isn't enough data for statistical significance, and no winner can be determined.` : `兩組投放條件不對等（${imbalanceDesc}），數據量尚不足以達統計顯著性，因此無法判定勝出版本。`)
        : (en ? `The two groups had similar delivery conditions, but the metric differences are below the significance threshold, so there is no clear winner.` : `兩組投放條件相近，但各項指標差距未達顯著水準，因此判定無明顯勝出版本。`),
      actions: imbalanced
        ? (en ? [`Next time, equalize the budget and delivery period of both versions before judging`, `Keep using the current main creative for now; don't replace it hastily`] : [`下次實驗請拉齊兩版的預算與投放期間，再行判定`, `先沿用現有主力素材，不貿然汰換`])
        : (en ? [`You can end this experiment and keep the current main creative`, `Next time, test a more pronounced variable (e.g. a completely different visual or hook)`] : [`可結束本次實驗，沿用現有主力素材`, `下次調整更顯著的變數（如完全不同的視覺或 hook）再測`]),
    }
  }

  // 3) pending + imbalanced.
  if (imbalanced) {
    return {
      pattern: null,
      roiWinner: 'inconclusive',
      interpretation: en
        ? `${ctrPhrase}, but the two groups' delivery conditions are unequal (${imbalanceDesc}), so there isn't enough data for significance and no winner can be determined yet.`
        : `${ctrPhrase}，但兩組投放條件不對等（${imbalanceDesc}），數據量尚不足以達統計顯著性，目前無法判定勝出版本。`,
      actions: en
        ? [`Equalize the budget and delivery period of both versions, then judge`, `Avoid swapping creatives while conditions are unequal`]
        : [`拉齊兩版的預算與投放期間後再行判定`, `避免在條件不對等時就汰換素材`],
    }
  }

  // 4) pending + balanced → pattern rules.
  const ctrUp = ctrDelta > 0.15
  const ctrDown = ctrDelta < -0.05
  const roasUp = roasDelta > 0.10
  const roasDown = roasDelta < -0.15

  if (ctrUp && roasDown) {
    return {
      pattern: en ? 'Curiosity clicks' : '好奇點擊',
      roiWinner: hasControl ? 'control' : 'inconclusive',
      interpretation: en
        ? `${vl} CTR jumped sharply, meaning the creative hook works and grabs attention. But the sharp drop in click value is the more important signal: visitors aren't taking follow-up action, so it may be attracting "curiosity clicks" rather than genuinely interested people. The high CPC also suggests Meta's algorithm gives ${vl} a lower "quality score."`
        : `${vl} CTR 大幅提升，代表創意 hook 有效、成功引發受眾注意力。但點擊效益大幅下滑是更關鍵的訊號：點進來的用戶沒有後續行動，吸引的可能是「好奇點擊」而非真正有意願的族群。CPC 偏高也顯示 Meta 演算法對 ${vl} 的「品質分」較低。`,
      actions: en
        ? [`Hold off on stopping ${baseLabel} — click value ${baseStats.roas.toFixed(1)} /NT$100 is the best so far; keep it`, `Investigate ${vl}'s traffic quality: check whether clickers complete the target action`, `${vl}'s hook works; try optimizing the CTA or landing page so back-end conversion keeps up`]
        : [`暫緩停止${baseLabel}——點擊效益 ${baseStats.roas.toFixed(1)} 次/百元 是目前最佳表現，先保留`, `調查 ${vl} 的流量質量：確認點進來的用戶是否完成目標行動`, `${vl} hook 有效，試著優化 CTA 或 landing page，讓後段轉換跟上`],
    }
  }

  if (ctrUp && roasUp) {
    return {
      pattern: en ? 'Across-the-board winner' : '全面領先',
      roiWinner: v,
      interpretation: en
        ? `${vl} beats ${baseLabel} on both CTR and click value — a genuinely effective creative upgrade. The audience is not only more willing to click but also acts more after clicking.`
        : `${vl} 在點擊率與點擊效益雙雙優於${baseLabel}，是真正有效的素材升級。受眾不只更願意點擊，點進來後的後續行動也更好。`,
      actions: en
        ? [`Gradually shift more budget to ${vl} and reduce ${baseLabel}'s share`, `Record how ${vl} differs from ${baseLabel} (copy, visual, CTA) as a design principle for the next creative`]
        : [`可以逐步增加 ${vl} 預算比例，縮減${baseLabel}份額`, `記錄 ${vl} 與${baseLabel}的差異（文案、視覺、CTA），作為下次素材的設計原則`],
    }
  }

  if (ctrDown && roasUp) {
    return {
      pattern: en ? 'Precise conversion' : '精準轉換',
      roiWinner: v,
      interpretation: en
        ? `${vl} CTR didn't rise much, but click value is higher — it attracts more intent-driven audiences rather than broad curiosity clicks. That's a sign of high-quality traffic.`
        : `${vl} CTR 雖未大幅增加，但點擊效益更高——吸引的是更有意願的受眾，而非廣泛的好奇點擊。這是高品質流量的訊號。`,
      actions: en
        ? [`Consider replacing ${baseLabel} with ${vl} as the main creative`, `This kind of creative pairs well with retargeting audiences to amplify the precise-conversion advantage`]
        : [`考慮以 ${vl} 取代${baseLabel}作為主力素材`, `這類素材適合搭配再行銷受眾，放大精準轉換優勢`],
    }
  }

  if (!ctrUp && !roasUp && roasDown) {
    return {
      pattern: null,
      roiWinner: hasControl ? 'control' : 'inconclusive',
      interpretation: en
        ? `${vl} doesn't beat ${baseLabel} on any metric; ${baseLabel} remains the best choice for now.`
        : `${vl} 各項指標均未優於${baseLabel}，目前${baseLabel}仍是最佳選擇。`,
      actions: en
        ? [`Pause or reduce ${vl}'s budget`, `Re-examine what makes ${vl} different and test a more pronounced variable next time`]
        : [`暫停或縮減 ${vl} 預算`, `重新審視 ${vl} 素材的差異點，下次實驗調整更顯著的變數`],
    }
  }

  return {
    pattern: null,
    roiWinner: 'inconclusive',
    interpretation: en
      ? `The two groups had similar delivery conditions, but the CTR and click-value gaps are still small (below significance), so there's no clear winner yet — accumulate more impressions before judging.`
      : `兩組投放條件相近，但 CTR 與點擊效益差距都還小（未達顯著水準），目前看不出明確的勝出版本，建議再累積一些曝光量後判讀。`,
    actions: en
      ? [`Hold steady and re-evaluate after impressions increase`, `To decide faster, test a more pronounced variable next time (visual or hook)`]
      : [`維持現狀，等待曝光量增加後再評估`, `若想更快分出高下，下次可調整更顯著的變數（視覺或 hook）`],
  }
}

function AbTestPanel({ creatives, labels, experiment, onExperimentUpdate }: {
  creatives: AdData['creatives']   // members of this experiment only
  labels: Record<string, LabelEntry>
  experiment: Experiment
  onExperimentUpdate: (experimentId: string, update: ExperimentUpdate) => void
}) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [localDiagnosis, setLocalDiagnosis] = useState(experiment.aiDiagnosis)
  const [localName, setLocalName] = useState(experiment.name ?? '')

  useEffect(() => { setLocalDiagnosis(experiment.aiDiagnosis) }, [experiment.aiDiagnosis])
  useEffect(() => { setLocalName(experiment.name ?? '') }, [experiment.name])

  const groups: Record<Variant, AdData['creatives']> = { control: [], A: [], B: [] }
  for (const c of creatives) {
    const v = labels[c.id]?.variant
    if (v) groups[v].push(c)
  }
  const controlStats = groups.control.length > 0 ? calcGroupStats(groups.control) : null
  const aStats = groups.A.length > 0 ? calcGroupStats(groups.A) : null
  const bStats = groups.B.length > 0 ? calcGroupStats(groups.B) : null

  const baseStats = controlStats ?? aStats
  const variantStats = controlStats ? (aStats ?? bStats) : bStats

  const winner = experiment.winner as WinnerType
  const winnerStats = winner === 'A' ? aStats : winner === 'B' ? bStats : null

  const totalLinkClicks = (arr: AdData['creatives']) =>
    arr.reduce((sum, c) => sum + (c.linkClicks ?? 0), 0)

  const baseGroup = groups.control.length > 0 ? groups.control : groups.A
  const variantGroup = controlStats ? (groups.A.length > 0 ? groups.A : groups.B) : groups.B
  const baseLinkClicks = totalLinkClicks(baseGroup)
  const variantLinkClicks = variantStats ? totalLinkClicks(variantGroup) : 0
  const baseCpc = baseLinkClicks > 0 && baseStats ? parseFloat((baseStats.totalSpend / baseLinkClicks).toFixed(2)) : 0
  const variantCpc = variantLinkClicks > 0 && variantStats ? parseFloat((variantStats.totalSpend / variantLinkClicks).toFixed(2)) : 0

  const winnerGroup = winner === 'A' ? groups.A : winner === 'B' ? groups.B : []
  const winnerLinkClicks = totalLinkClicks(winnerGroup)
  const winnerCpc = winnerLinkClicks > 0 && winnerStats ? parseFloat((winnerStats.totalSpend / winnerLinkClicks).toFixed(2)) : 0

  const tableRows = [
    { label: 'CTR', ctrl: baseStats ? `${baseStats.ctr.toFixed(2)}%` : '—', variant: variantStats ? `${variantStats.ctr.toFixed(2)}%` : '—' },
    { label: 'CPC', ctrl: baseCpc > 0 ? `$${baseCpc.toFixed(2)}` : '—', variant: variantCpc > 0 ? `$${variantCpc.toFixed(2)}` : '—' },
    { label: L('花費', 'Spend'), ctrl: baseStats ? fmtK(baseStats.totalSpend) : '—', variant: variantStats ? fmtK(variantStats.totalSpend) : '—' },
    { label: L('連結點擊數', 'Link clicks'), ctrl: baseLinkClicks > 0 ? baseLinkClicks.toLocaleString() : '—', variant: variantLinkClicks > 0 ? variantLinkClicks.toLocaleString() : '—' },
  ]

  const ctrDelta = winnerStats && baseStats && baseStats.ctr > 0
    ? (winnerStats.ctr - baseStats.ctr) / baseStats.ctr * 100 : null
  const cpaDelta = baseCpc > 0 && winnerCpc > 0
    ? (baseCpc - winnerCpc) / baseCpc * 100 : null

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 8px', border: '1px solid #bfdbfe', borderRadius: 6,
    background: 'white', color: '#1e293b', fontFamily: 'var(--font-dm-sans)', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ marginTop: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{L('實驗名稱', 'Experiment name')}</label>
        <input
          type="text"
          value={localName}
          onChange={e => setLocalName(e.target.value)}
          onBlur={() => { if (localName !== (experiment.name ?? '')) onExperimentUpdate(experiment.id, { name: localName }) }}
          placeholder={L('例：[2026/5/20] 推廣 D67 演講節', 'e.g. [2026/5/20] Promote D67 Speech Festival')}
          style={{ fontSize: 12, padding: '5px 8px', border: '1px solid #bfdbfe', borderRadius: 6, background: 'white', color: '#1e293b', fontFamily: 'var(--font-dm-sans)', width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 4, fontWeight: 500, color: '#64748b' }}>{L('指標', 'Metric')}</th>
            <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 500, color: '#64748b' }}>{L('控制組', 'Control')}</th>
            <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 500, color: '#1d4ed8' }}>{L('AI 建議版', 'AI version')}</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map(r => (
            <tr key={r.label} style={{ borderTop: '1px solid #dbeafe' }}>
              <td style={{ padding: '4px 0', color: '#64748b' }}>{r.label}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--font-dm-mono)', fontWeight: 500 }}>{r.ctrl}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--font-dm-mono)', fontWeight: 500, color: '#1d4ed8' }}>{r.variant}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{L('實驗結果', 'Result')}</label>
        <select value={winner} onChange={e => {
          const newWinner = e.target.value
          const update: ExperimentUpdate = { winner: newWinner }
          if (newWinner === 'A' || newWinner === 'B') {
            const winStats = newWinner === 'A' ? aStats : bStats
            const wClicks = totalLinkClicks(newWinner === 'A' ? groups.A : groups.B)
            const wCpc = wClicks > 0 && winStats ? winStats.totalSpend / wClicks : 0
            if (winStats && baseStats && baseStats.ctr > 0) update.ctrDelta = parseFloat(((winStats.ctr - baseStats.ctr) / baseStats.ctr * 100).toFixed(1))
            if (baseCpc > 0 && wCpc > 0) update.cpaDelta = parseFloat(((baseCpc - wCpc) / baseCpc * 100).toFixed(1))
          }
          onExperimentUpdate(experiment.id, update)
        }} style={{ ...inputStyle, cursor: 'pointer' }}>
          {winnerOptions(en).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {winnerStats && baseStats && (ctrDelta !== null || cpaDelta !== null) && (
        <p style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, margin: '0 0 8px' }}>
          {L('AI 建議版', 'AI version')}
          {ctrDelta !== null && ` CTR ${ctrDelta > 0 ? '+' : ''}${ctrDelta.toFixed(0)}%`}
          {ctrDelta !== null && cpaDelta !== null && L('，', ', ')}
          {cpaDelta !== null && ` CPC ${cpaDelta > 0 ? L('降低', 'down') : L('上升', 'up')} ${cpaDelta > 0 ? '-' : '+'}${Math.abs(cpaDelta).toFixed(0)}%`}
        </p>
      )}

      <div>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{L('AI 當初的診斷說了什麼', "What did the AI's diagnosis say?")}</label>
        <textarea
          value={localDiagnosis}
          onChange={e => setLocalDiagnosis(e.target.value)}
          onBlur={() => { if (localDiagnosis !== experiment.aiDiagnosis) onExperimentUpdate(experiment.id, { aiDiagnosis: localDiagnosis }) }}
          placeholder={L('貼上 AI Sidekick 給出的建議內容...', 'Paste the advice AI Sidekick gave…')}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    </div>
  )
}

function ExperimentResultCard({ creatives, labels, experiment, onDelete }: {
  creatives: AdData['creatives']   // members of this experiment only
  labels: Record<string, LabelEntry>
  experiment: Experiment
  onDelete?: (experimentId: string) => void
}) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const groups: Record<Variant, AdData['creatives']> = { control: [], A: [], B: [] }
  for (const c of creatives) {
    const v = labels[c.id]?.variant
    if (v) groups[v].push(c)
  }

  const hasControl = groups.control.length > 0
  const hasA = groups.A.length > 0
  const hasB = groups.B.length > 0
  if (!((hasControl && (hasA || hasB)) || (hasA && hasB))) return null

  const controlStats = hasControl ? calcGroupStats(groups.control) : null
  const aStats = hasA ? calcGroupStats(groups.A) : null
  const bStats = hasB ? calcGroupStats(groups.B) : null
  const baseStats = controlStats ?? aStats!

  const rows: { stats: GroupStats; variant: Variant }[] = []
  if (controlStats) rows.push({ stats: controlStats, variant: 'control' })
  if (aStats) rows.push({ stats: aStats, variant: 'A' })
  if (bStats) rows.push({ stats: bStats, variant: 'B' })

  const testStats = controlStats ? (aStats ?? bStats) : bStats
  const testLabel: 'A' | 'B' = controlStats ? (aStats ? 'A' : 'B') : 'B'
  const winner = (experiment.winner as WinnerType) ?? 'pending'
  const diag = testStats ? buildAbDiagnosis(baseStats, testStats, testLabel, hasControl, winner, en) : null

  return (
    <div style={{ marginBottom: 16, borderRadius: 12, border: '1.5px solid #bfdbfe', background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>🧪</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{L('A/B 實驗結果', 'A/B Test Result')}</span>
        {experiment.name && <span style={{ fontSize: 11, color: '#64748b', background: '#e0e7ff', padding: '2px 8px', borderRadius: 10 }}>{experiment.name}</span>}
        {onDelete && (
          <button
            onClick={() => { if (window.confirm(L(`確定要刪除實驗「${experiment.name || '未命名'}」嗎？此實驗的廣告標籤會一併清除。`, `Delete experiment "${experiment.name || 'untitled'}"? Its ad labels will also be cleared.`))) onDelete(experiment.id) }}
            style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {L('刪除', 'Delete')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ stats, variant }) => {
          const isBase = variant === 'control' || (!hasControl && variant === 'A')
          const style = VARIANT_STYLE[variant]
          return (
            <div key={variant} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.7)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: style.bg, color: style.color, whiteSpace: 'nowrap', minWidth: 52, textAlign: 'center' }}>{variantLabel(variant, en)}</span>
              <div style={{ flex: 1, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                <div>
                  <span style={{ color: '#64748b' }}>CTR </span>
                  <span style={{ fontWeight: 600 }}>{stats.ctr.toFixed(2)}%</span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.ctr, baseStats.ctr, true) }}>{pct(stats.ctr, baseStats.ctr)}</span>}
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>CPC </span>
                  <span style={{ fontWeight: 600 }}>${stats.cpa.toFixed(0)}</span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.cpa, baseStats.cpa, false) }}>{pct(stats.cpa, baseStats.cpa)}</span>}
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>{L('點擊效益', 'Click value')} </span>
                  <span style={{ fontWeight: 600 }}>{stats.roas.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, color: '#94a3b8' }}>{L(' 次/百元', '/NT$100')}</span></span>
                  {!isBase && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: pctColor(stats.roas, baseStats.roas, true) }}>{pct(stats.roas, baseStats.roas)}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {diag && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.85)', border: '1px solid #bfdbfe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11 }}>📌</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>{L('AI Sidekick 診斷', 'AI Sidekick Diagnosis')}</span>
            {diag.pattern && (
              <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}>{diag.pattern}</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#334155', lineHeight: 1.65, margin: '0 0 8px 0' }}>{diag.interpretation}</p>
          <div style={{ fontSize: 11.5, color: '#475569' }}>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>{L('建議行動', 'Recommended actions')}</div>
            {diag.actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 2 }}>
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>•</span>
                <span>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function CreativeSection({ data, onAskAI, creativeLabels, experiments, onLabelChange, onCreateExperiment, onExperimentUpdate, onDeleteExperiment, dateFrom, dateTo, pageId, idToken }: {
  data: AdData
  onAskAI?: (q: string, autoSend?: boolean) => void
  creativeLabels?: Record<string, LabelEntry>
  experiments?: Experiment[]
  onLabelChange?: (adId: string, variant: Variant | null, experimentId?: string) => void
  onCreateExperiment?: (name: string) => Promise<string>
  onExperimentUpdate?: (experimentId: string, update: ExperimentUpdate) => void
  onDeleteExperiment?: (experimentId: string) => void
  dateFrom?: string
  dateTo?: string
  pageId?: string
  idToken?: string
}) {
  const { L, lang } = useLang()
  const en = lang === 'en'
  const [sortBy, setSortBy] = useState<SortBy>('roas')
  const [filter, setFilter] = useState('全部')
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const labels = creativeLabels ?? {}
  const exps = experiments ?? []

  // Historical ranges (start before the ~30-day snapshot window) fetch on-demand from
  // Meta; recent ranges use the fast snapshot. Shared with Budget via the same hook.
  const { creatives: histCreatives, loading: histLoading, exceedsWindow } = useHistoricalCreatives(dateFrom, dateTo, pageId, idToken)
  const sourceCreatives = useMemo(
    () => (exceedsWindow ? (histCreatives ?? []) : data.creatives),
    [exceedsWindow, histCreatives, data.creatives],
  )

  const sorted = useMemo(() => {
    let arr = [...sourceCreatives]
    if (filter !== '全部') arr = arr.filter(c => c.type === filter)
    if (sortBy === 'roas') arr.sort((a, b) => b.roas - a.roas)
    else if (sortBy === 'spend') arr.sort((a, b) => b.spend - a.spend)
    else arr.sort((a, b) => a.cpa - b.cpa)
    return arr
  }, [sourceCreatives, sortBy, filter])

  const membersOf = (expId: string) => sourceCreatives.filter(c => labels[c.id]?.experimentId === expId)

  return (
    <div>
      <div className="ads-section-header">
        <Icon name="creative" size={15} color="var(--ad-blue)" />
        <span className="ads-section-title">{L('素材庫 & 績效排行', 'Creative Library & Ranking')}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {onAskAI && <button className="ads-diag-ask-btn" style={{ borderRadius: 7 }} onClick={() => onAskAI(L('哪支素材表現最好？', 'Which creative performs best?'))}>✨ {L('問 AI 分析素材', 'Ask AI')}</button>}
          <div className="ads-tabs">
            {TYPES.map(t => <button key={t} className={`ads-tab ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>{typeLabel(t, en)}</button>)}
          </div>
          <select
            style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--ad-border)', borderRadius: 7, background: 'var(--ad-surface)', color: 'var(--ad-text2)', cursor: 'pointer', fontFamily: 'var(--font-dm-sans)' }}
            value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
          >
            <option value="roas">{L('點擊效益 ↓', 'Click value ↓')}</option>
            <option value="spend">{L('花費 ↓', 'Spend ↓')}</option>
            <option value="cpa">CPC ↑</option>
          </select>
        </div>
      </div>

      {onLabelChange && exps.map(exp => (
        <ExperimentResultCard
          key={exp.id}
          creatives={membersOf(exp.id)}
          labels={labels}
          experiment={exp}
          onDelete={onDeleteExperiment}
        />
      ))}

      {exceedsWindow && !histLoading && sorted.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--ad-text3)', margin: '0 0 8px' }}>
          {L('歷史區間素材（即時取自 Meta，不含已刪除的廣告）', 'Historical range — fetched live from Meta (deleted ads not included)')}
        </p>
      )}
      {histLoading && (
        <p style={{ textAlign: 'center', color: 'var(--ad-text3)', padding: 40 }}>
          {L('載入歷史素材中…', 'Loading historical creatives…')}
        </p>
      )}
      {!histLoading && sorted.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--ad-text3)', padding: 40 }}>
          {exceedsWindow
            ? L('此日期區間沒有投放過的廣告素材（已刪除的廣告 Meta 不提供）', 'No ad creatives were delivered in this date range (deleted ads are not returned by Meta).')
            : L('尚無廣告素材資料，請先同步廣告數據', 'No ad creative data yet — sync ad data first')}
        </p>
      )}
      <div className="ads-creative-grid" style={histLoading ? { display: 'none' } : undefined}>
        {sorted.map((c, i) => {
          const label = labels[c.id]
          const exp = label ? exps.find(e => e.id === label.experimentId) : undefined
          return (
            <div key={c.id} className="ads-creative-card" style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
                {onLabelChange && onCreateExperiment && (
                  <ExperimentBadge adId={c.id} label={label} experiments={exps} onLabelChange={onLabelChange} onCreateExperiment={onCreateExperiment} onExperimentUpdate={onExperimentUpdate} />
                )}
                {onAskAI && <button
                  title={L('用 AI 分析此素材', 'Analyze this creative with AI')}
                  onClick={() => onAskAI(buildCreativePrompt(c, en), true)}
                  style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid var(--ad-border)', borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer', color: 'var(--ad-blue)', fontWeight: 500, lineHeight: 1.4 }}
                >✨ {L('分析', 'Analyze')}</button>}
              </div>
              <div className={`ads-creative-thumb ${c.thumb}`}>
                <div className={`ads-creative-rank ${c.status === 'top' ? 'top' : c.status === 'bad' ? 'bad' : ''}`}>{i + 1}</div>
                <div className={`ads-creative-status ${c.status}`}>{statusLabel(c.status, en)}</div>
                <span style={{ opacity: 0.5 }}>{c.type} · {c.channel}</span>
              </div>
              <div className="ads-creative-info">
                <div className="ads-creative-name" title={[c.campaignName, c.adName || c.name].filter(Boolean).join(' › ')}>{renderAdName(c.name)}</div>
                <div className="ads-creative-meta">
                  {[[L('點擊效益', 'Click value'), c.roas.toFixed(1) + 'x'], [L('花費', 'Spend'), fmtK(c.spend)], ['CTR', Number(c.ctr).toFixed(2) + '%'], ['CPC', '$' + (c.cpc ?? c.cpa)]].map(([k, v]) => (
                    <div key={k} className="ads-creative-kv">
                      <span style={{ color: 'var(--ad-text3)' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--font-dm-mono)', fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              {label && exp && onExperimentUpdate && (
                <>
                  <button
                    onClick={() => setExpandedCard(prev => prev === c.id ? null : c.id)}
                    style={{ width: '100%', textAlign: 'center', fontSize: 11, color: 'var(--ad-blue)', background: 'none', border: 'none', borderTop: '1px solid var(--ad-border)', padding: '6px 0', cursor: 'pointer', fontFamily: 'var(--font-dm-sans)' }}
                  >
                    {L('查看 A/B 對比', 'View A/B comparison')} {expandedCard === c.id ? '↑' : '↓'}
                  </button>
                  <div style={{ overflow: 'hidden', maxHeight: expandedCard === c.id ? '600px' : '0', opacity: expandedCard === c.id ? 1 : 0, transition: 'max-height 0.3s ease, opacity 0.25s ease' }}>
                    <div style={{ padding: '0 8px 8px' }}>
                      <AbTestPanel creatives={membersOf(exp.id)} labels={labels} experiment={exp} onExperimentUpdate={onExperimentUpdate} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
