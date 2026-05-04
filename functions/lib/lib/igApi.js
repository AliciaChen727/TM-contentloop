"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchIgMedia = fetchIgMedia;
exports.fetchIgMediaInsights = fetchIgMediaInsights;
const BASE = 'https://graph.facebook.com/v21.0';
async function fetchIgMedia(igUserId, pageToken) {
    const url = new URL(`${BASE}/${igUserId}/media`);
    url.searchParams.set('access_token', pageToken);
    // like_count / comments_count 直接從 media 取，不走 insights
    url.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp,like_count,comments_count');
    url.searchParams.set('limit', '50');
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error)
        throw new Error(data.error?.message ?? 'fetchIgMedia failed');
    return data.data ?? [];
}
async function fetchIgMediaInsights(mediaId, mediaType, pageToken) {
    const metrics = [
        'reach',
        'saved',
        'shares',
        ...(mediaType === 'REELS' ? ['video_views'] : []),
    ].join(',');
    const url = new URL(`${BASE}/${mediaId}/insights`);
    url.searchParams.set('access_token', pageToken);
    url.searchParams.set('metric', metrics);
    url.searchParams.set('period', 'lifetime');
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error)
        throw new Error(data.error?.message ?? 'fetchIgMediaInsights failed');
    const map = {};
    for (const metric of data.data ?? []) {
        const val = metric.value ?? metric.values?.[0]?.value ?? 0;
        map[metric.name] = typeof val === 'number' ? val : 0;
    }
    return {
        reach: map['reach'] ?? 0,
        saved: map['saved'] ?? 0,
        shares: map['shares'] ?? 0,
        views: map['video_views'] ?? 0,
    };
}
//# sourceMappingURL=igApi.js.map