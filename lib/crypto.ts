/**
 * Symmetric encryption for credentials stored in the database (email app
 * passwords, API keys). AES-256-GCM with a key derived from an existing server
 * secret, so no new env var is required to deploy.
 *
 * The derivation source prefers SESSION_SECRET (always present in this app) and
 * falls back to ENCRYPTION_KEY / DATABASE_URL. Stored values are tagged with a
 * "v1:" prefix; anything without the prefix is treated as legacy plaintext and
 * returned as-is, and decrypt failures return "" so a rotated secret degrades to
 * "credential not set" (re-enter it) rather than crashing email sending.
 */
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const SALT = 'cleanfreaks.email.v1'

function getKey(): Buffer {
  const source =
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.DATABASE_URL ||
    'cleanfreaks-insecure-fallback-key'
  return crypto.scryptSync(source, SALT, 32)
}

/** Encrypt a plaintext secret. Returns "" for empty input. */
export function encryptSecret(plain: string | null | undefined): string {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/** Decrypt a stored secret. Returns "" on failure; passes through legacy plaintext. */
export function decryptSecret(enc: string | null | undefined): string {
  if (!enc) return ''
  if (!enc.startsWith('v1:')) return enc // legacy/plaintext value
  try {
    const [, ivB64, tagB64, ctB64] = enc.split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ct = Buffer.from(ctB64, 'base64')
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return ''
  }
}
