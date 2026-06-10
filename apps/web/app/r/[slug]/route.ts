// Public short-link redirect: /r/{slug} → logs the click (bot-filtered,
// page-scoped, privacy-safe) then 302-redirects to the destination.
// When the link has conversion tracking on, it also (a) sets a first-party
// click cookie and (b) appends ?cl_id=<clickId> so a later /c hit or webhook
// can tie the registration back to this exact click. Node runtime (Admin SDK).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { isBotUA, uaCategory, hashIp } from '@/lib/links/util'
import { buildFbc } from '@/lib/meta/capi'

const HOME = 'https://tm-contentloop.vercel.app/'

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug
  try {
    const linkSnap = await adminDb.collection('shortLinks').doc(slug).get()
    const link = linkSnap.data()
    if (!linkSnap.exists || !link || link.active === false || !link.destination) {
      return NextResponse.redirect(HOME, 302)
    }
    const pageId = link.pageId as string
    const trackConversion = link.trackConversion === true

    const ua = req.headers.get('user-agent') ?? ''
    const bot = isBotUA(ua)
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    const referer = req.headers.get('referer') ?? ''

    // Pre-allocate the click id so we can carry it into the cookie / cl_id param.
    const linkRef = adminDb.collection('pages').doc(pageId).collection('links').doc(slug)
    const clickRef = linkRef.collection('clicks').doc()
    const clickId = clickRef.id

    // For CAPI ROAS attribution: capture the ad's fbclid → fbc, and keep the raw
    // ip/ua (matching signals Meta needs). Only when conversion tracking is on.
    const fbclid = req.nextUrl.searchParams.get('fbclid')
    const capiData = trackConversion && !bot
      ? { fbc: fbclid ? buildFbc(fbclid) : null, rawIp: ip || null, rawUa: ua.slice(0, 400) || null }
      : null

    await Promise.all([
      clickRef.set({
        ts: FieldValue.serverTimestamp(),
        uaCategory: uaCategory(ua),
        referer: referer.slice(0, 300),
        ipHash: hashIp(ip),
        isBot: bot,
        postId: (link.source?.postId as string) ?? null,
        ...(capiData ? { capi: capiData } : {}),
      }),
      linkRef.set({ clickCount: FieldValue.increment(bot ? 0 : 1), lastClickAt: FieldValue.serverTimestamp() }, { merge: true }),
    ])

    // Build the destination, carrying cl_id when conversion tracking is on.
    let dest = link.destination as string
    if (trackConversion && !bot) {
      try {
        const u = new URL(dest)
        u.searchParams.set('cl_id', clickId)
        dest = u.toString()
      } catch { /* leave dest as-is on malformed URL */ }
    }

    const res = NextResponse.redirect(dest, 302)
    if (trackConversion && !bot) {
      // First-party cookie so a same-browser /c hit can tie the conversion back.
      res.cookies.set(`cl_${slug}`, clickId, { httpOnly: true, sameSite: 'lax', maxAge: 7200, path: '/' })
    }
    return res
  } catch {
    return NextResponse.redirect(HOME, 302)
  }
}
