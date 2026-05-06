export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { parseFbInsightsMarkdown } from '@/lib/parsers/fbInsightsMarkdown'

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

  const body = await req.json() as { markdown: string; pageId: string }
  const { markdown, pageId } = body
  if (!markdown?.trim()) return NextResponse.json({ error: 'Missing markdown' }, { status: 400 })
  if (!pageId?.trim()) return NextResponse.json({ error: 'Missing pageId' }, { status: 400 })

  const parsed = parseFbInsightsMarkdown(markdown, pageId)

  const userRef = adminDb.collection('users').doc(uid)
  const now = Timestamp.now()
  let pageInsightsSaved = false
  let postReachUpdated = 0
  let postReachSkipped = 0
  let bizUpdated = 0
  let bizSkipped = 0

  // Save page-level insights snapshot
  if (parsed.pageInsights) {
    const importId = Date.now().toString()
    const docRef = userRef.collection('fbPageInsights').doc(importId)
    await docRef.set({ ...parsed.pageInsights, importedAt: now })
    pageInsightsSaved = true
  }

  // Update per-post reach in fbPosts (permalink-based)
  if (parsed.postReachRows.length > 0) {
    const batch = adminDb.batch()
    for (const row of parsed.postReachRows) {
      const docId = extractDocId(row.permalink, pageId)
      if (!docId) { postReachSkipped++; continue }

      const postRef = userRef.collection('fbPosts').doc(docId)
      const update: Record<string, unknown> = {
        reachImportedAt: now,
        'insights.reach': row.reach,
      }
      if (row.impressions > 0) update['insights.impressions'] = row.impressions

      batch.set(postRef, update, { merge: true })
      postReachUpdated++
    }
    await batch.commit()
  }

  // Update fbPosts with BizSuite data (matched by createdTime ±5 min)
  if (parsed.bizSuiteRows.length > 0) {
    const fbSnap = await userRef.collection('fbPosts').get()
    // Build minute-keyed map: "YYYY-MM-DDTHH:MM" → docId
    const timeMap = new Map<string, string>()
    for (const doc of fbSnap.docs) {
      const ct = doc.data().createdTime
      if (!ct) continue
      const iso = ct.toDate().toISOString().slice(0, 16)
      timeMap.set(iso, doc.id)
    }

    const batch = adminDb.batch()
    for (const row of parsed.bizSuiteRows) {
      if (!row.publishDate) { bizSkipped++; continue }
      const rowMinute = row.publishDate.slice(0, 16)
      let docId: string | undefined
      for (let delta = 0; delta <= 5 && !docId; delta++) {
        for (const sign of [1, -1]) {
          const candidate = offsetMinute(rowMinute, delta * sign)
          if (timeMap.has(candidate)) { docId = timeMap.get(candidate); break }
        }
      }
      if (!docId) { bizSkipped++; continue }

      const postRef = userRef.collection('fbPosts').doc(docId)
      const update: Record<string, unknown> = {
        bizImportedAt: now,
        'insights.reach': row.reach,
        'insights.likes': row.likes,
        'insights.comments': row.comments,
        'insights.shares': row.shares,
        'insights.saves': row.saves,
        'insights.linkClicks': row.linkClicks,
      }
      if (row.videoViews3s > 0) update['insights.videoViews3s'] = row.videoViews3s
      if (row.videoViews1m > 0) update['insights.videoViews1m'] = row.videoViews1m
      if (row.watchTimeMin > 0) update['insights.watchTimeMin'] = row.watchTimeMin

      batch.set(postRef, update, { merge: true })
      bizUpdated++
    }
    await batch.commit()
  }

  return NextResponse.json({
    type: parsed.type,
    pageInsightsSaved,
    postReachUpdated,
    postReachSkipped,
    bizUpdated,
    bizSkipped,
    warnings: parsed.warnings,
  })
}

function offsetMinute(isoMinute: string, delta: number): string {
  const d = new Date(isoMinute + ':00Z')
  d.setUTCMinutes(d.getUTCMinutes() + delta)
  return d.toISOString().slice(0, 16)
}

function extractDocId(permalink: string, pageId: string): string | null {
  if (!permalink) return null
  const m1 = permalink.match(/facebook\.com\/(?:\d+|[^/?#]+)\/posts\/(\d+)/)
  if (m1) return `${pageId}_${m1[1]}`
  const fbid = permalink.match(/story_fbid=(\d+)/)
  const pid = permalink.match(/[?&]id=(\d+)/)
  if (fbid && pid) return `${pid[1]}_${fbid[1]}`
  const photo = permalink.match(/fbid=(\d+)/)
  if (photo) return `${pageId}_${photo[1]}`
  return null
}
