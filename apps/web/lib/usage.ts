import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const IMAGE_UNIT_COST_USD = 0.02   // Imagen 3 Fast
const VIDEO_PER_SECOND_USD = 0.50  // Veo 2

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

export async function recordImageGeneration(uid: string): Promise<void> {
  try {
    await adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).set({
      imageCount: FieldValue.increment(1),
      imageCostUsd: FieldValue.increment(IMAGE_UNIT_COST_USD),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch {
    // non-critical: do not block response
  }
}

export async function recordVideoGeneration(uid: string, durationSeconds: number): Promise<void> {
  try {
    const cost = durationSeconds * VIDEO_PER_SECOND_USD
    await adminDb.collection('users').doc(uid).collection('usage').doc(currentMonth()).set({
      videoCount: FieldValue.increment(1),
      videoSeconds: FieldValue.increment(durationSeconds),
      videoCostUsd: FieldValue.increment(cost),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch {
    // non-critical
  }
}
