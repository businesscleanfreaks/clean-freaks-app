/**
 * Workspace-level invoice email template + resolver.
 *
 * One template per business (singleton row), resolved per invoice at draft time
 * by substituting {client} {month} {month_short} {total} {due_date}. Resolving
 * server-side at draft creation (not at render) means a later template edit does
 * not silently rewrite drafts the operator may have already tweaked.
 */
import { prisma } from '@/lib/db'

export const DEFAULT_SUBJECT = 'Invoice · {client} · {month}'
export const DEFAULT_MESSAGE =
  'Hi {client}, please find attached your invoice for {total} for {month}. Payment is due by {due_date}. Thank you for your business.'

export interface EmailTemplateValues {
  subject: string
  message: string
}

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

export interface TemplateVars {
  client: string
  month: string // e.g. "June 2026"
  monthShort?: string // e.g. "Jun 2026"
  total: string // formatted, e.g. "$2,050.00"
  dueDate: string // e.g. "June 10, 2026"
}

/** Substitute the supported variables. {month_short} falls back to {month}. */
export function resolveTemplate(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{client\}/g, vars.client)
    .replace(/\{month_short\}/g, vars.monthShort || vars.month)
    .replace(/\{month\}/g, vars.month)
    .replace(/\{total\}/g, vars.total)
    .replace(/\{due_date\}/g, vars.dueDate)
}

/** Resolve both subject and message for an invoice in one call. */
export function resolveEmailTemplate(template: EmailTemplateValues, vars: TemplateVars): EmailTemplateValues {
  return {
    subject: resolveTemplate(template.subject, vars),
    message: resolveTemplate(template.message, vars),
  }
}
