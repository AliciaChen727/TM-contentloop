export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { processPageAlerts } from '@/lib/alerts/processAlerts'

// Hourly cron (GitHub Actions). Decoupled from data sync: checks every page's
// schedule (alertEnabled / alertDays / alertHour, Taiwan time) and sends the
// current alert digest when its slot has arrived and nothing was sent today.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pageRefs = await adminDb.collection('pages').listDocuments()
  const results = await Promise.all(
    pageRefs.map(async ref => {
      try { return { pageId: ref.id, ...(await processPageAlerts(ref.id)) } }
      catch (e) { return { pageId: ref.id, sent: false, reason: e instanceof Error ? e.message : 'alert error' } }
    })
  )

  const sentCount = results.filter(r => r.sent).length
  console.log('[cron/send-alerts] sent=', sentCount, JSON.stringify(results))
  return NextResponse.json({ checked: results.length, sent: sentCount, results })
}
