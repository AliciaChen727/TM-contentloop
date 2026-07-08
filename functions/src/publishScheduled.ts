import * as functions from 'firebase-functions'

export const publishScheduled = functions
  .region('asia-east1')
  .runWith({ secrets: ['CRON_SECRET'] })
  .pubsub.schedule('*/5 * * * *')
  .onRun(async () => {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      functions.logger.error('CRON_SECRET is missing. Make sure it is set in Google Cloud Secret Manager.')
      return null
    }

    try {
      functions.logger.info('Triggering scheduled publish...')
      const res = await fetch('https://tm-contentloop.vercel.app/api/cron/publish-scheduled', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cronSecret}`,
          'Content-Type': 'application/json'
        }
      })
      const text = await res.text()
      functions.logger.info(`Response status: ${res.status}, body: ${text}`)
    } catch (err) {
      functions.logger.error('Failed to trigger scheduled publish', err)
    }

    return null
  })
