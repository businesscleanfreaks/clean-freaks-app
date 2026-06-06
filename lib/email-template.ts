/**
 * Server-side invoice email template loader. The pure (client-safe) resolver and
 * defaults live in lib/invoice-template.ts and are re-exported here so existing
 * server imports keep working.
 */
import { prisma } from '@/lib/db'
import {
  DEFAULT_SUBJECT,
  DEFAULT_MESSAGE,
  type EmailTemplateValues,
} from '@/lib/invoice-template'

export {
  DEFAULT_SUBJECT,
  DEFAULT_MESSAGE,
  resolveTemplate,
  resolveEmailTemplate,
} from '@/lib/invoice-template'
export type { EmailTemplateValues, TemplateVars } from '@/lib/invoice-template'

/** The singleton template, falling back to defaults when none has been saved. */
export async function getEmailTemplate(): Promise<EmailTemplateValues> {
  try {
    const row = await prisma.emailTemplate.findFirst({ orderBy: { createdAt: 'asc' } })
    return {
      subject: row?.subject || DEFAULT_SUBJECT,
      message: row?.message || DEFAULT_MESSAGE,
    }
  } catch {
    return { subject: DEFAULT_SUBJECT, message: DEFAULT_MESSAGE }
  }
}
