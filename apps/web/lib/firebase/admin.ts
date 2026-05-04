import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

function getAdminApp(): App {
  if (getApps().length) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

// Lazy singletons — only initialized on first actual request, not at module load
let _db: ReturnType<typeof getFirestore> | undefined
let _auth: ReturnType<typeof getAuth> | undefined

export function getAdminDb() {
  if (!_db) _db = getFirestore(getAdminApp())
  return _db
}

export function getAdminAuth() {
  if (!_auth) _auth = getAuth(getAdminApp())
  return _auth
}

// Keep backward-compatible aliases for existing routes
export const adminDb = new Proxy({} as ReturnType<typeof getFirestore>, {
  get(_, prop) { return (getAdminDb() as unknown as Record<string | symbol, unknown>)[prop] },
})
export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_, prop) { return (getAdminAuth() as unknown as Record<string | symbol, unknown>)[prop] },
})
