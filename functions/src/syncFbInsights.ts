import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { fetchPagePosts } from './lib/fbApi'

const db = admin.firestore()

interface PageTokenDoc {
  pageId: string
  pageName: string
  accessToken: string
  igUserId: string | null
}

// 每天台灣時間凌晨 3 點執行（UTC 19:00）
export const syncFbInsights = functions
  .region('asia-east1')
  .pubsub.schedule('0 19 * * *')
  .timeZone('Asia/Taipei')
  .onRun(async () => {
    functions.logger.info('syncFbInsights started')

    const usersSnap = await db.collection('users').listDocuments()

    for (const userRef of usersSnap) {
      const tokenSnap = await userRef
        .collection('metaTokens')
        .doc('page')
        .get()

      if (!tokenSnap.exists) continue

      const tokenData = tokenSnap.data() as PageTokenDoc
      const { pageId, accessToken } = tokenData

      try {
        await syncUserFbPosts(userRef.id, pageId, accessToken)
      } catch (err) {
        functions.logger.error(`syncFbInsights failed for user ${userRef.id}`, err)
      }
    }

    functions.logger.info('syncFbInsights completed')
    return null
  })

async function syncUserFbPosts(uid: string, pageId: string, pageToken: string) {
  const posts = await fetchPagePosts(pageId, pageToken)
  functions.logger.info(`Fetched ${posts.length} posts for user ${uid}`)

  const batch = db.batch()
  const now = admin.firestore.Timestamp.now()

  for (const post of posts) {
    const postRef = db
      .collection('users')
      .doc(uid)
      .collection('fbPosts')
      .doc(post.id)

    batch.set(postRef, {
      postId: post.id,
      message: post.message ?? post.story ?? '',
      createdTime: admin.firestore.Timestamp.fromDate(new Date(post.created_time)),
      permalink: post.permalink_url ?? '',
      snapshotAt: now,
      engagementAvailable: post.engagementAvailable,
      insights: {
        reactions: post.reactions?.summary?.total_count ?? 0,
        comments: post.comments?.summary?.total_count ?? 0,
        shares: post.shares?.count ?? 0,
      },
    }, { merge: true })
  }

  await batch.commit()
  functions.logger.info(`Wrote ${posts.length} fbPosts for user ${uid}`)
}
