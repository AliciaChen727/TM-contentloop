"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPagePosts = fetchPagePosts;
const BASE = 'https://graph.facebook.com/v21.0';
async function fetchPagePosts(pageId, pageToken) {
    const url = new URL(`${BASE}/${pageId}/posts`);
    url.searchParams.set('access_token', pageToken);
    url.searchParams.set('fields', 'id,message,story,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares');
    url.searchParams.set('limit', '50');
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error)
        throw new Error(data.error?.message ?? 'fetchPagePosts failed');
    return data.data ?? [];
}
//# sourceMappingURL=fbApi.js.map