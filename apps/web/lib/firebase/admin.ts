import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const globalForFirebase = globalThis as typeof globalThis & {
  __contentLoopAdminApp?: App
  __contentLoopAdminDb?: ReturnType<typeof getFirestore>
  __contentLoopAdminAuth?: ReturnType<typeof getAuth>
}

function getAdminApp(): App {
  if (globalForFirebase.__contentLoopAdminApp) return globalForFirebase.__contentLoopAdminApp
  if (getApps().length) return getApps()[0]
  const app = initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
  globalForFirebase.__contentLoopAdminApp = app
  return app
}

export function getAdminDb() {
  if (!globalForFirebase.__contentLoopAdminDb) {
    const db = getFirestore(getAdminApp())
    try {
      db.settings({ ignoreUndefinedProperties: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('already been initialized')) throw error
    }
    globalForFirebase.__contentLoopAdminDb = db
  }
  return globalForFirebase.__contentLoopAdminDb
}

export function getAdminAuth() {
  if (!globalForFirebase.__contentLoopAdminAuth) globalForFirebase.__contentLoopAdminAuth = getAuth(getAdminApp())
  return globalForFirebase.__contentLoopAdminAuth
}

// Keep backward-compatible aliases for existing routes
export const adminDb = new Proxy({} as ReturnType<typeof getFirestore>, {
  get(_, prop) { return (getAdminDb() as unknown as Record<string | symbol, unknown>)[prop] },
})
export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_, prop) { return (getAdminAuth() as unknown as Record<string | symbol, unknown>)[prop] },
})
