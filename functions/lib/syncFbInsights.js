"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncFbInsights = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fbApi_1 = require("./lib/fbApi");
const db = admin.firestore();
// 每天台灣時間凌晨 3 點執行（UTC 19:00）
exports.syncFbInsights = functions
    .region('asia-east1')
    .pubsub.schedule('0 19 * * *')
    .timeZone('Asia/Taipei')
    .onRun(async () => {
    functions.logger.info('syncFbInsights started');
    const usersSnap = await db.collection('users').listDocuments();
    for (const userRef of usersSnap) {
        const tokenSnap = await userRef
            .collection('metaTokens')
            .doc('page')
            .get();
        if (!tokenSnap.exists)
            continue;
        const tokenData = tokenSnap.data();
        const { pageId, accessToken } = tokenData;
        try {
            await syncUserFbPosts(userRef.id, pageId, accessToken);
        }
        catch (err) {
            functions.logger.error(`syncFbInsights failed for user ${userRef.id}`, err);
        }
    }
    functions.logger.info('syncFbInsights completed');
    return null;
});
async function syncUserFbPosts(uid, pageId, pageToken) {
    const posts = await (0, fbApi_1.fetchPagePosts)(pageId, pageToken);
    functions.logger.info(`Fetched ${posts.length} posts for user ${uid}`);
    const batch = db.batch();
    const now = admin.firestore.Timestamp.now();
    const fbPostsCol = db.collection('users').doc(uid).collection('fbPosts');
    // Read existing docs first and take max(existing, new) per engagement metric so an
    // intermittent empty FB API response never overwrites previously-synced real values.
    const existingSnaps = posts.length > 0
        ? await db.getAll(...posts.map(p => fbPostsCol.doc(p.id)))
        : [];
    const existingById = new Map();
    for (const snap of existingSnaps)
        if (snap.exists)
            existingById.set(snap.id, snap.data());
    for (const post of posts) {
        const prev = existingById.get(post.id)?.insights ?? {};
        batch.set(fbPostsCol.doc(post.id), {
            postId: post.id,
            message: post.message ?? post.story ?? '',
            createdTime: admin.firestore.Timestamp.fromDate(new Date(post.created_time)),
            permalink: post.permalink_url ?? '',
            snapshotAt: now,
            engagementAvailable: post.engagementAvailable,
            insights: {
                reactions: Math.max(prev.reactions ?? 0, post.reactions?.summary?.total_count ?? 0),
                comments: Math.max(prev.comments ?? 0, post.comments?.summary?.total_count ?? 0),
                shares: Math.max(prev.shares ?? 0, post.shares?.count ?? 0),
            },
        }, { merge: true });
    }
    await batch.commit();
    functions.logger.info(`Wrote ${posts.length} fbPosts for user ${uid}`);
}
//# sourceMappingURL=syncFbInsights.js.map