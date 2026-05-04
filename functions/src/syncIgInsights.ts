import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { fetchIgMedia, fetchIgMediaInsights } from './lib/igApi'

const db = admin.firestore()

interface PageTokenDoc {
  pageId: string
  accessToken: string
  igUserId: string | null
}

// 每天台灣時間凌晨 3:30 執行（比 FB sync 晚 30 分鐘）
export const syncIgInsights = functions
  .region('asia-east1')
  .pubsub.schedule('30 19 * * *')
  .timeZone('Asia/Taipei')
  .onRun(async () => {
    functions.logger.info('syncIgInsights started')

    const usersSnap = await db.collection('users').listDocuments()

    for (const userRef of usersSnap) {
      const tokenSnap = await userRef
        .collection('metaTokens')
        .doc('page')
        .get()

      if (!tokenSnap.exists) continue

      const tokenData = tokenSnap.data() as PageTokenDoc
      const { accessToken, igUserId } = tokenData

      if (!igUserId) {
        functions.logger.warn(`User ${userRef.id} has no igUserId, skipping`)
        continue
      }

      try {
        await syncUserIgMedia(userRef.id, igUserId, accessToken)
      } catch (err) {
        functions.logger.error(`syncIgInsights failed for user ${userRef.id}`, err)
      }
    }

    functions.logger.info('syncIgInsights completed')
    return null
  })

async function syncUserIgMedia(uid: string, igUserId: string, pageToken: string) {
  const mediaList = await fetchIgMedia(igUserId, pageToken)
  functions.logger.info(`Fetched ${mediaList.length} IG media for user ${uid}`)

  const batch = db.batch()
  const now = admin.firestore.Timestamp.now()

  for (const media of mediaList) {
    let insights
    try {
      insights = await fetchIgMediaInsights(media.id, media.media_type, pageToken)
    } catch (err) {
      functions.logger.warn(`Could not fetch insights for media ${media.id}`, err)
      insights = { reach: 0, saved: 0, shares: 0, views: 0 }
    }

    const mediaRef = db
      .collection('users')
      .doc(uid)
      .collection('igPosts')
      .doc(media.id)

    batch.set(mediaRef, {
      mediaId: media.id,
      caption: media.caption ?? '',
      mediaType: media.media_type,
      permalink: media.permalink ?? '',
      timestamp: admin.firestore.Timestamp.fromDate(new Date(media.timestamp)),
      snapshotAt: now,
      insights: {
        reach: insights.reach,
        likes: media.like_count ?? 0,
        comments: media.comments_count ?? 0,
        saved: insights.saved,
        shares: insights.shares,
        views: insights.views,
      },
    }, { merge: true })
  }

  await batch.commit()
  functions.logger.info(`Wrote ${mediaList.length} igPosts for user ${uid}`)
}
