#!/bin/bash

# We will modify apps/web/app/api/cron/sync/route.ts to include the full ad level sync logic from today.

# Since this involves a complex rewrite of syncAdsForUser in the cron job, let's use a node script to replace the function.

node -e "
const fs = require('fs');

let cronSync = fs.readFileSync('apps/web/app/api/cron/sync/route.ts', 'utf8');
let adsSync = fs.readFileSync('apps/web/app/api/ads/sync/route.ts', 'utf8');

// Extract the core fetch and processing logic from adsSync
// From lines 55 (const pageDoc = ...) up to line 415 (return NextResponse.json...)
const adsMatch = adsSync.match(/const accountsUrl = new URL.*?const userRef = adminDb\.collection\('users'\)\.doc\(uid\)/s);
if (!adsMatch) throw new Error('Could not match adsSync body');

// Extract the body but replace the first line to use our variables
let body = adsMatch[0];

// Replace userAccessToken references, etc.
// In cron/sync, we have \`userAccessToken\` passed as argument.
// In adsSync, it is \`userAccessToken\` too!

// Wait, the dates in adsSync are dynamic from \`since\` and \`until\`.
// We need to set them to last 30 days.
body = \`  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(toDate.getDate() - 30)
  const since = fromDate.toISOString().slice(0, 10)
  const until = toDate.toISOString().slice(0, 10)
  const dateRange = { since, until }
\` + body;

// Also, the adsSync logic ends with setting the database.
// Let's get the rest of the database writes.
const dbWritesMatch = adsSync.match(/await insightsRef\.set\(.*?\n  }\)/s);
let dbWrites = dbWritesMatch[0];

// In cron/sync, we also need to write to adAccountSnapshots!
const snapshotWrites = \`
  await adminDb.collection('pages').doc(pageId).collection('adAccountSnapshots').doc(adAccountId).set({
    adAccountId,
    contributorUid: uid,
    syncedAt: Timestamp.now(),
    dateRange: { from: since, to: until },
    conversionType,
    summary: { spend, reach, impressions, clicks, ctr, cpm, frequency, conversions, revenue, roas, cpa },
    daily,
    hourly,
    adCreatives: adCreativesWithTitle,
    adPostIds,
    adPostMetrics,
    igPostIds,
    igPostMetrics,
  })
  return { adAccountId, spend, reach, conversionType, linkClicks, videoViews, pageAdsCount: pageAdsList.length }
\`;

const fullFuncBody = body + '\n  ' + dbWrites + '\n' + snapshotWrites;

// Replace syncAdsForUser in cronSync
const newCronSync = cronSync.replace(
  /async function syncAdsForUser.*?return \{ adAccountId.*?\}\n\}/s,
  'async function syncAdsForUser(uid: string, userAccessToken: string, pageId: string, igUserId?: string): Promise<{ adAccountId?: string; spend?: number; reach?: number; conversionType?: string; linkClicks?: number; videoViews?: number; pageAdsCount?: number; error?: string }> {\n' + fullFuncBody + '\n}'
);

fs.writeFileSync('apps/web/app/api/cron/sync/route.ts', newCronSync);
console.log('Cron script updated!');
"
