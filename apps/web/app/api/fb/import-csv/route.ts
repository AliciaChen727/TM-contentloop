export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const COL_PERMALINK = ['永久連結', 'Permalink', 'Post URL', 'Link', '連結', 'post_url', 'url']
const COL_REACH = ['觸及人數', 'Reach', 'Post Reach', '觸及', 'people reached', 'reach']
const COL_REACTIONS = ['按讚次數', '按讚、留言和分享', 'Reactions', 'Likes', '互動次數', 'post reactions', 'reactions', 'likes']
const COL_COMMENTS = ['留言數', 'Comments', 'Post Comments', '留言', 'comments']
const COL_SHARES = ['分享次數', 'Shares', 'Post Shares', '分享', 'shares']
const COL_IMPRESSIONS = ['曝光次數', 'Impressions', 'Post Impressions', '曝光', 'impressions']

function findCol(headers: string[], candidates: string[]): string | null {
  for (const h of headers) {
    for (const c of candidates) {
      if (h.toLowerCase().replace(/[\s_]/g, '').includes(c.toLowerCase().replace(/[\s_]/g, ''))) return h
    }
  }
  return null
}

function extractDocId(permalink: string, pageId: string): string | null {
  if (!permalink) return null
  // https://www.facebook.com/{pageId}/posts/{postId}
  const m1 = permalink.match(/facebook\.com\/(?:\d+|[^/?#]+)\/posts\/(\d+)/)
  if (m1) return `${pageId}_${m1[1]}`
  // https://www.facebook.com/permalink.php?story_fbid={postId}&id={pageId}
  const fbid = permalink.match(/story_fbid=(\d+)/)
  const pid = permalink.match(/[?&]id=(\d+)/)
  if (fbid && pid) return `${pid[1]}_${fbid[1]}`
  // https://www.facebook.com/photo/?fbid={photoId}&...
  const photo = permalink.match(/fbid=(\d+)/)
  if (photo) return `${pageId}_${photo[1]}`
  return null
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

  const body = await req.json() as { rows: Record<string, string>[]; pageId: string }
  const { rows, pageId } = body
  if (!rows?.length || !pageId) return NextResponse.json({ error: 'Missing rows or pageId' }, { status: 400 })

  const headers = Object.keys(rows[0])
  const colPermalink = findCol(headers, COL_PERMALINK)
  if (!colPermalink) return NextResponse.json({ error: 'Cannot detect permalink column', headers }, { status: 400 })

  const colReach = findCol(headers, COL_REACH)
  const colReactions = findCol(headers, COL_REACTIONS)
  const colComments = findCol(headers, COL_COMMENTS)
  const colShares = findCol(headers, COL_SHARES)
  const colImpressions = findCol(headers, COL_IMPRESSIONS)

  const now = Timestamp.now()
  const batch = adminDb.batch()
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const permalink = row[colPermalink]?.trim()
    const docId = extractDocId(permalink, pageId)
    if (!docId) { skipped++; continue }

    const postRef = adminDb.collection('users').doc(uid).collection('fbPosts').doc(docId)
    const insights: Record<string, number> = {}
    if (colReactions) insights.reactions = parseInt(row[colReactions] ?? '0') || 0
    if (colComments) insights.comments = parseInt(row[colComments] ?? '0') || 0
    if (colShares) insights.shares = parseInt(row[colShares] ?? '0') || 0
    if (colReach) insights.reach = parseInt(row[colReach] ?? '0') || 0
    if (colImpressions) insights.impressions = parseInt(row[colImpressions] ?? '0') || 0

    batch.set(postRef, { insights, engagementAvailable: true, permalink, csvImportedAt: now }, { merge: true })
    updated++
  }

  await batch.commit()
  return NextResponse.json({ updated, skipped, detectedCols: { colPermalink, colReach, colReactions, colComments, colShares } })
}
