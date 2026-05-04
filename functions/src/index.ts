import * as admin from 'firebase-admin'

admin.initializeApp()

export { syncFbInsights } from './syncFbInsights'
export { syncIgInsights } from './syncIgInsights'
