import { adminDb } from '@/lib/firebase/admin'
import { decrypt } from '@/lib/encrypt'

type KeyType = 'anthropic' | 'gemini'

export async function getUserApiKey(uid: string, type: KeyType): Promise<string | null> {
  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get()
  const encrypted = snap.data()?.[type]
  if (!encrypted) return null
  try {
    return decrypt(encrypted)
  } catch {
    return null
  }
}
