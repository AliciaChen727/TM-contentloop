export interface PageInsightsResult {
  periodLabel: string
  periodStart: string | null
  periodEnd: string | null
  pageViews: number
  videoViews3s: number
  videoViews1m: number
  watchTimeMin: number
  followerPct: number
  nonFollowerPct: number
  contentType: Record<string, number>
  rawMarkdown: string
}

export interface PostReachRow {
  permalink: string
  reach: number
  impressions: number
}

export interface BizSuiteRow {
  publishDateLabel: string  // original "5月6日 18:17"
  publishDate: string | null  // ISO "2026-05-06T18:17:00"
  content?: string
  reach: number
  viewers: number
  interactions: number
  likes: number
  comments: number
  shares: number
  saves: number
  linkClicks: number
  videoViews3s: number
  videoViews1m: number
  watchTimeMin: number
}

export interface ParseResult {
  type: 'pageInsights' | 'postReach' | 'bizSuite' | 'both'
  pageInsights: PageInsightsResult | null
  postReachRows: PostReachRow[]
  bizSuiteRows: BizSuiteRow[]
  warnings: string[]
}

// --- Number cleaning ---

function cleanNumber(raw: string): number {
  // Remove commas, +/- prefix, whitespace
  const cleaned = raw.replace(/[,，\s]/g, '').replace(/^[+-]/, '')
  return parseFloat(cleaned) || 0
}

function cleanPercent(raw: string): number {
  return cleanNumber(raw.replace('%', ''))
}

/** Convert watch time string to total minutes.
 *  Handles: "2小時17分鐘", "2h 17m", "137分鐘", "137", "2:17"
 */
function parseWatchTime(raw: string): number {
  const clean = raw.trim()
  // "X小時Y分鐘" or "X時Y分"
  const zhMatch = clean.match(/(\d+)\s*[小時時hH]+\s*(\d*)\s*[分鐘分mM]?/)
  if (zhMatch) {
    const hours = parseInt(zhMatch[1]) || 0
    const mins = parseInt(zhMatch[2]) || 0
    return hours * 60 + mins
  }
  // "Xh Ym" or "Xh"
  const hMatch = clean.match(/(\d+)\s*h\s*(\d*)\s*m?/i)
  if (hMatch) {
    return parseInt(hMatch[1]) * 60 + (parseInt(hMatch[2]) || 0)
  }
  // "X:Y"
  const colonMatch = clean.match(/^(\d+):(\d+)$/)
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])
  // Plain number (assume minutes)
  return cleanNumber(clean)
}

// --- Keyword matchers ---

type FieldKey =
  | 'pageViews'
  | 'videoViews3s'
  | 'videoViews1m'
  | 'watchTimeMin'
  | 'followerPct'
  | 'nonFollowerPct'
  | 'contentType.reel'
  | 'contentType.photo'
  | 'contentType.multiPhoto'
  | 'contentType.link'
  | 'contentType.stories'
  | 'contentType.video'

const FIELD_KEYWORDS: Array<{ key: FieldKey; keywords: string[] }> = [
  { key: 'videoViews1m', keywords: ['觀看 1 分鐘', '1分鐘', '1-Minute', '1 minute', 'one minute', 'views_1min'] },
  { key: 'videoViews3s', keywords: ['觀看 3 秒', '3秒', '3-Second', '3 second', 'three second', 'views_3s'] },
  { key: 'watchTimeMin', keywords: ['觀看時間', 'Watch Time', 'watch time', 'view time', '觀看分鐘數'] },
  { key: 'pageViews', keywords: ['瀏覽次數', 'Page Views', 'page views', 'page_views', '頁面瀏覽'] },
  { key: 'nonFollowerPct', keywords: ['非追蹤者', 'Non-follower', 'Non follower', 'non_follower'] },
  { key: 'followerPct', keywords: ['追蹤者', 'Follower', 'follower'] },
  { key: 'contentType.reel', keywords: ['Reel', 'reels'] },
  { key: 'contentType.multiPhoto', keywords: ['多相片', 'Multi-photo', 'Multi photo', 'carousel'] },
  { key: 'contentType.photo', keywords: ['相片', 'Photo', 'photo', 'image'] },
  { key: 'contentType.link', keywords: ['連結', 'Link', 'link'] },
  { key: 'contentType.stories', keywords: ['限時動態', 'Stories', 'stories'] },
  { key: 'contentType.video', keywords: ['影片', 'Video', 'video'] },
]

function matchField(text: string): FieldKey | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  for (const { key, keywords } of FIELD_KEYWORDS) {
    for (const kw of keywords) {
      if (t.includes(kw.toLowerCase())) return key
    }
  }
  return null
}

// --- Date range extraction ---

function extractDateRange(md: string): { periodLabel: string; periodStart: string | null; periodEnd: string | null } {
  // Matches: "4月8日 - 5月5日", "Apr 8 - May 5", "2025-04-08 ~ 2025-05-05", "過去 28 天"
  const isoRange = md.match(/(\d{4}-\d{2}-\d{2})\s*[~\-–—]\s*(\d{4}-\d{2}-\d{2})/)
  if (isoRange) return { periodLabel: isoRange[0], periodStart: isoRange[1], periodEnd: isoRange[2] }

  // Chinese month-day range e.g. "4月8日 - 5月5日" (assume current year)
  const zhRange = md.match(/(\d{1,2})月(\d{1,2})日\s*[~\-–—]\s*(\d{1,2})月(\d{1,2})日/)
  if (zhRange) {
    const year = new Date().getFullYear()
    const start = `${year}-${String(zhRange[1]).padStart(2, '0')}-${String(zhRange[2]).padStart(2, '0')}`
    const end = `${year}-${String(zhRange[3]).padStart(2, '0')}-${String(zhRange[4]).padStart(2, '0')}`
    return { periodLabel: zhRange[0], periodStart: start, periodEnd: end }
  }

  const zhPast = md.match(/過去\s*(\d+)\s*天/)
  if (zhPast) return { periodLabel: `過去 ${zhPast[1]} 天`, periodStart: null, periodEnd: null }

  return { periodLabel: '', periodStart: null, periodEnd: null }
}

// --- Main page insights parser ---

function parsePageInsights(md: string): Omit<PageInsightsResult, 'rawMarkdown'> {
  const result: Omit<PageInsightsResult, 'rawMarkdown'> = {
    ...extractDateRange(md),
    pageViews: 0,
    videoViews3s: 0,
    videoViews1m: 0,
    watchTimeMin: 0,
    followerPct: 0,
    nonFollowerPct: 0,
    contentType: {},
  }

  const lines = md.split('\n')

  for (const line of lines) {
    const stripped = line.replace(/^[#*>\-|]+\s*/, '').trim()
    if (!stripped) continue

    // Try to find "label ... number" or "label | number" patterns
    // Also handle markdown table rows: "| Reel | 55.9% |"
    const tableMatch = line.match(/\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/)
    if (tableMatch) {
      const label = tableMatch[1].trim()
      const value = tableMatch[2].trim()
      const field = matchField(label)
      if (field) applyField(result, field, value)
      continue
    }

    // "label: value" or "label value" on same line
    // e.g. "瀏覽次數 4,402" or "瀏覽次數: 4,402 ↑41%"
    const field = matchField(stripped)
    if (field) {
      // Look for a number/percent in this line
      const numMatch = stripped.match(/[\d,，]+\.?\d*\s*%?/)
      if (numMatch) applyField(result, field, numMatch[0])
      continue
    }

    // Check if it's a number line that follows a label line
    // (handled inline above, skip)
  }

  // Second pass: handle lines where label and value are on separate lines
  // e.g. "瀏覽次數\n4,402"
  for (let i = 0; i < lines.length - 1; i++) {
    const labelLine = lines[i].replace(/^[#*>\-|]+\s*/, '').trim()
    const valueLine = lines[i + 1].replace(/^[#*>\-|]+\s*/, '').trim()

    if (!labelLine || !valueLine) continue
    const field = matchField(labelLine)
    if (!field) continue

    // Value line should look like a number or percent
    if (/^[\d,，.%\s小時分鐘hmHM:+]+$/.test(valueLine)) {
      applyField(result, field, valueLine)
    }
  }

  return result
}

function applyField(
  result: Omit<PageInsightsResult, 'rawMarkdown'>,
  field: FieldKey,
  raw: string,
) {
  const isPercent = field.endsWith('Pct') || field.startsWith('contentType.')
  const value = isPercent ? cleanPercent(raw) : (field === 'watchTimeMin' ? parseWatchTime(raw) : cleanNumber(raw))

  if (field.startsWith('contentType.')) {
    const sub = field.replace('contentType.', '')
    result.contentType[sub] = value
  } else if (field === 'pageViews') result.pageViews = value
  else if (field === 'videoViews3s') result.videoViews3s = value
  else if (field === 'videoViews1m') result.videoViews1m = value
  else if (field === 'watchTimeMin') result.watchTimeMin = value
  else if (field === 'followerPct') result.followerPct = value
  else if (field === 'nonFollowerPct') result.nonFollowerPct = value
}

// --- Post reach parser ---

function parsePostReach(md: string): PostReachRow[] {
  const rows: PostReachRow[] = []
  const lines = md.split('\n')

  // Find table header line to understand column positions
  let headerLine = -1
  let colPermalink = -1
  let colReach = -1
  let colImpressions = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('|')) continue
    const cols = line.split('|').map(c => c.trim()).filter(Boolean)
    const reachIdx = cols.findIndex(c => /觸及|reach/i.test(c) && !/曝光/i.test(c))
    const linkIdx = cols.findIndex(c => /連結|permalink|url/i.test(c))
    const impressionIdx = cols.findIndex(c => /曝光|impression/i.test(c))

    if (reachIdx !== -1 && linkIdx !== -1) {
      headerLine = i
      colPermalink = linkIdx
      colReach = reachIdx
      colImpressions = impressionIdx
      break
    }
  }

  if (headerLine === -1) {
    // Fallback: look for facebook.com URLs near numbers
    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/www\.facebook\.com\/[^\s)]+/)
      if (!urlMatch) continue
      const nums = line.match(/\d[\d,，]*/g) || []
      if (nums.length >= 1 && nums[0] !== undefined) {
        rows.push({
          permalink: urlMatch[0],
          reach: cleanNumber(nums[0]),
          impressions: nums[1] !== undefined ? cleanNumber(nums[1]) : 0,
        })
      }
    }
    return rows
  }

  for (let i = headerLine + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('|')) continue
    const cols = line.split('|').map(c => c.trim()).filter(Boolean)
    if (cols.length < 2) continue

    const permalink = cols[colPermalink] ?? ''
    const reachRaw = cols[colReach] ?? '0'
    const impressionsRaw = colImpressions !== -1 ? (cols[colImpressions] ?? '0') : '0'

    const urlMatch = permalink.match(/https?:\/\/www\.facebook\.com\/[^\s)]+/)
    const docPermalink = urlMatch?.[0] ?? permalink

    if (!docPermalink.includes('facebook.com')) continue

    rows.push({
      permalink: docPermalink,
      reach: cleanNumber(reachRaw),
      impressions: cleanNumber(impressionsRaw),
    })
  }

  return rows
}

// --- BizSuite content table parser ---

// BizSuite exports times in Taiwan local time (UTC+8).
// Convert to UTC so it matches Firestore's createdTime (which is stored in UTC).
function parseBizDate(raw: string): string | null {
  const clean = raw.trim()
  // "5月6日 18:17"
  const m1 = clean.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/)
  if (m1) {
    const year = new Date().getFullYear()
    const localIso = `${year}-${String(m1[1]).padStart(2, '0')}-${String(m1[2]).padStart(2, '0')}T${String(m1[3]).padStart(2, '0')}:${m1[4]}:00+08:00`
    return new Date(localIso).toISOString().slice(0, 19)
  }
  // "2025年12月31日"
  const m2 = clean.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (m2) {
    const localIso = `${m2[1]}-${String(m2[2]).padStart(2, '0')}-${String(m2[3]).padStart(2, '0')}T00:00:00+08:00`
    return new Date(localIso).toISOString().slice(0, 19)
  }
  // "5月6日" (no time)
  const m3 = clean.match(/(\d{1,2})月(\d{1,2})日/)
  if (m3) {
    const year = new Date().getFullYear()
    const localIso = `${year}-${String(m3[1]).padStart(2, '0')}-${String(m3[2]).padStart(2, '0')}T00:00:00+08:00`
    return new Date(localIso).toISOString().slice(0, 19)
  }
  return null
}


function isBizSuiteMd(md: string): boolean {
  return /發佈日期/.test(md) && /觸及人數|觸及/.test(md)
}

// Business Suite Markdown embeds page-level navigation UI between posts.
// These strings are never actual post content.
const BS_UI_NOISE = new Set([
  '直欄', '你的限時動態', '限時動態', '這則貼文沒有文字',
  '加強推廣', '開啟下拉式功能表', '已多文發佈', '查看更多',
  '貼文', '相片', '影片', '直播', '精選', '活動',
  '全部', '已發佈', '已排程', '草稿', '已過期',
])

function parseBizSuiteContentTable(md: string): BizSuiteRow[] {
  // Headers are split one-per-line in the actual Markdown export.
  // Detect data rows by date pattern in cols[1] and use fixed column positions:
  // cols[1]=date, cols[2]=瀏覽次數, cols[3]=觸及人數(reach), cols[4]=瀏覽者,
  // cols[5]=互動次數, cols[6]=按讚, cols[7]=留言, cols[8]=分享, cols[9]=儲存,
  // cols[10]=連結點擊, cols[16]=觀看3秒, cols[17]=觀看1分鐘
  const rows: BizSuiteRow[] = []
  const DATE_RE = /\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月/

  // Pre-scan: lines appearing ≥5 times are page-name/attribution noise, not post content
  const lineCounts = new Map<string, number>()
  for (const raw of md.split('\n')) {
    const t = raw.trim()
    if (!t || t.length < 5 || t.startsWith('|')) continue
    if (/^!?\[.*?\]\(.*?\)$/.test(t)) continue
    lineCounts.set(t, (lineCounts.get(t) ?? 0) + 1)
  }
  const dynamicNoise = new Set<string>()
  for (const [line, count] of lineCounts) {
    if (count >= 5) dynamicNoise.add(line)
  }

  // Collect non-table text lines between data rows as post content.
  // Business Suite Markdown interleaves: image lines, post text, then |date|metrics| row.
  const pendingTextLines: string[] = []
  let seenFirstTableRow = false  // discard preamble navigation text before any data row

  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) {
      if (!seenFirstTableRow) continue  // skip document preamble entirely
      const trimmed = line.trim()
      if (trimmed === '') continue
      // Skip image/icon markdown
      if (/^!?\[.*?\]\(.*?\)$/.test(trimmed)) continue
      // Skip known Business Suite navigation UI strings
      if (BS_UI_NOISE.has(trimmed)) continue
      // Skip very short strings (single-word labels, page handles like "legacytmc")
      if (trimmed.length < 5) continue
      // Skip pure hashtag/mention clusters (e.g. "#tag1 #tag2 @handle")
      if (/^([#@]\S+\s*)+$/.test(trimmed)) continue
      // Skip repeating page-name / attribution lines detected by frequency
      if (dynamicNoise.has(trimmed)) continue
      pendingTextLines.push(trimmed)
      continue
    }

    seenFirstTableRow = true

    const cols = line.split('|').map(c => c.trim())
    // cols[0] is '' (before first |), cols[1] is first cell
    if (cols.length < 5) continue
    const firstVal = cols[1] ?? ''
    if (!DATE_RE.test(firstVal)) continue
    if (/^-+$/.test(firstVal)) continue

    // Join all accumulated non-noise lines as content; take first line as the display title
    const content = pendingTextLines.length > 0 ? pendingTextLines[0] : undefined
    pendingTextLines.length = 0

    const n = (idx: number): number => {
      const raw = cols[idx] ?? ''
      if (raw === '——' || raw === '--' || raw === '') return 0
      return cleanNumber(raw)
    }

    rows.push({
      publishDateLabel: firstVal,
      publishDate: parseBizDate(firstVal),
      content,
      reach: n(3),
      viewers: n(4),
      interactions: n(5),
      likes: n(6),
      comments: n(7),
      shares: n(8),
      saves: n(9),
      linkClicks: n(10),
      videoViews3s: n(16),
      videoViews1m: n(17),
      watchTimeMin: 0,
    })
  }

  return rows
}

// --- Detection helpers ---

function isPageInsightsMd(md: string): boolean {
  return /瀏覽次數|觀看 3 秒|Page Views|3.Second Views/i.test(md)
}

function isPostReachMd(md: string): boolean {
  return /facebook\.com/.test(md) && /觸及|reach/i.test(md)
}

// --- Public API ---

export function parseFbInsightsMarkdown(md: string): ParseResult {
  const warnings: string[] = []
  const hasBiz = isBizSuiteMd(md)
  const hasPost = !hasBiz && isPostReachMd(md)
  const hasPage = !hasBiz && isPageInsightsMd(md)

  let pageInsights: PageInsightsResult | null = null
  let postReachRows: PostReachRow[] = []
  let bizSuiteRows: BizSuiteRow[] = []

  if (hasPage) {
    const parsed = parsePageInsights(md)
    pageInsights = { ...parsed, rawMarkdown: md }
    if (pageInsights.pageViews === 0 && pageInsights.videoViews3s === 0) {
      warnings.push('偵測到粉絲頁洞察格式，但未能解析到任何數字，請確認 Markdown 內容')
    }
  }

  if (hasPost) {
    postReachRows = parsePostReach(md)
    if (postReachRows.length === 0) {
      warnings.push('偵測到貼文觸及格式，但未能解析任何貼文 URL')
    }
  }

  if (hasBiz) {
    bizSuiteRows = parseBizSuiteContentTable(md)
    if (bizSuiteRows.length === 0) {
      warnings.push('偵測到 Meta Business Suite 內容格式，但未能解析任何貼文列')
    }
  }

  if (!hasPage && !hasPost && !hasBiz) {
    warnings.push('無法識別 Markdown 格式，請確認是否包含 FB 洞察報告內容')
  }

  const type = hasBiz ? 'bizSuite' : hasPage && hasPost ? 'both' : hasPage ? 'pageInsights' : 'postReach'
  return { type, pageInsights, postReachRows, bizSuiteRows, warnings }
}
