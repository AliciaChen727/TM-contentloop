import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { getApps, getApp } from 'firebase/app'

const app = getApps().length ? getApp() : undefined
export const storage = app ? getStorage(app) : null

export async function uploadImageForCanva(
  uid: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!storage) throw new Error('Firebase Storage not initialized')
  const path = `uploads/${uid}/${Date.now()}-${file.name}`
  const task = uploadBytesResumable(ref(storage, path), file)
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snap => onProgress?.(snap.bytesTransferred / snap.totalBytes * 100),
      reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref)),
    )
  })
}

export async function uploadVideoForAnalysis(
  uid: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!storage) throw new Error('Firebase Storage not initialized')
  const path = `analysis/${uid}/${Date.now()}-${file.name}`
  const task = uploadBytesResumable(ref(storage, path), file)
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snap => onProgress?.(snap.bytesTransferred / snap.totalBytes * 100),
      reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref)),
    )
  })
}
