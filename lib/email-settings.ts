/**
 * Resolves the active email configuration.
 *
 * Source of truth is the singleton `EmailSettings` DB row (managed from
 * Settings → Email). When no row exists yet, every field falls back to the
 * corresponding environment variable, so deployments that predate the Settings
 * UI keep working unchanged. Secret fields are stored encrypted and decrypted
 * here before use.
 */
import { prisma } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'

export type EmailProvider = 'gmail' | 'resend'

export interface EmailConfig {
  provider: EmailProvider
  fromName: string
  fromEmail: string
  gmailUser: string
  gmailAppPassword: string
  resendApiKey: string
  testEmail: string
  enableSending: boolean
  allowRealClientEmails: boolean
}

/** Raw singleton row (oldest wins if duplicates ever exist). Null-safe. */
export async function getEmailSettingsRow() {
  try {
    return await prisma.emailSettings.findFirst({ orderBy: { createdAt: 'asc' } })
  } catch {
    return null
  }
}

/** Resolved, ready-to-use config: DB row when present, else env vars. */
export async function getEmailConfig(): Promise<EmailConfig> {
  const row = await getEmailSettingsRow()
  const env = process.env

  const provider: EmailProvider =
    (row?.provider || env.EMAIL_PROVIDER) === 'resend' ? 'resend' : 'gmail'

  return {
    provider,
    fromName: row?.fromName || env.EMAIL_FROM_NAME || 'Clean Freaks',
    fromEmail: row?.fromEmail || env.EMAIL_FROM || '',
    gmailUser: row?.gmailUser || env.GMAIL_USER || '',
    gmailAppPassword:
      (row?.gmailAppPassword ? decryptSecret(row.gmailAppPassword) : '') ||
      env.GMAIL_APP_PASSWORD ||
      '',
    resendApiKey:
      (row?.resendApiKey ? decryptSecret(row.resendApiKey) : '') ||
      env.RESEND_API_KEY ||
      '',
    testEmail: row?.testEmail || env.TEST_EMAIL || '',
    // Once a row exists, the UI toggles are authoritative; otherwise fall back to env flags.
    enableSending: row ? row.enableSending : env.ENABLE_EMAIL_SENDING === 'true',
    allowRealClientEmails: row
      ? row.allowRealClientEmails
      : env.ALLOW_REAL_CLIENT_EMAILS === 'true',
  }
}
