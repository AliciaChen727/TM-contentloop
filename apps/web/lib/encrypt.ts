import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALG = 'aes-256-gcm'

export function encrypt(text: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_SECRET!, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // layout: iv(24 hex chars) + authTag(32 hex chars) + ciphertext
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

export function decrypt(encoded: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_SECRET!, 'hex')
  const iv = Buffer.from(encoded.slice(0, 24), 'hex')
  const tag = Buffer.from(encoded.slice(24, 56), 'hex')
  const ciphertext = Buffer.from(encoded.slice(56), 'hex')
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}
