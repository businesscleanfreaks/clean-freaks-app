import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { encryptSecret } from '@/lib/crypto'
import { getEmailConfig, getEmailSettingsRow } from '@/lib/email-settings'
import { logger } from '@/lib/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const emailSettingsSchema = z.object({
  provider: z.enum(['gmail', 'resend']).optional(),
  fromName: z.string().max(120, 'Name too long').optional().nullable(),
  fromEmail: z.string().max(200, 'Email too long').optional().nullable(),
  gmailUser: z.string().max(200, 'Email too long').optional().nullable(),
  testEmail: z.string().max(200, 'Email too long').optional().nullable(),
  enableSending: z.boolean().optional(),
  allowRealClientEmails: z.boolean().optional(),
  enableInboxSync: z.boolean().optional(),
  autoConfirmHighConfidencePayments: z.boolean().optional(),
  // Secrets — only written when a non-empty value is supplied (blank = keep existing).
  gmailAppPassword: z.string().max(200).optional().nullable(),
  resendApiKey: z.string().max(400).optional().nullable(),
})

// GET — current email config. Secrets are never returned, only "set" flags.
export async function GET() {
  try {
    await requireAuth()
    const [config, row] = await Promise.all([getEmailConfig(), getEmailSettingsRow()])
    return NextResponse.json({
      provider: config.provider,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      gmailUser: config.gmailUser,
      testEmail: config.testEmail,
      enableSending: config.enableSending,
      allowRealClientEmails: config.allowRealClientEmails,
      enableInboxSync: row?.enableInboxSync ?? false,
      autoConfirmHighConfidencePayments: row?.autoConfirmHighConfidencePayments ?? false,
      lastInboxUid: row?.lastInboxUid ?? null,
      gmailAppPasswordSet: !!config.gmailAppPassword,
      resendApiKeySet: !!config.resendApiKey,
      hasRow: !!row,
    })
  } catch (error) {
    logger.error('Get email settings error:', error)
    return NextResponse.json({ error: 'Failed to load email settings' }, { status: 500 })
  }
}

// PUT — upsert the singleton settings row.
export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const result = emailSettingsSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.errors[0].message }, { status: 400 })
    }
    const d = result.data

    const data: {
      provider?: string
      fromName?: string | null
      fromEmail?: string | null
      gmailUser?: string | null
      testEmail?: string | null
      enableSending?: boolean
      allowRealClientEmails?: boolean
      enableInboxSync?: boolean
      autoConfirmHighConfidencePayments?: boolean
      gmailAppPassword?: string
      resendApiKey?: string
    } = {}
    if (d.provider !== undefined) data.provider = d.provider
    if (d.fromName !== undefined) data.fromName = d.fromName?.trim() || null
    if (d.fromEmail !== undefined) data.fromEmail = d.fromEmail?.trim() || null
    if (d.gmailUser !== undefined) data.gmailUser = d.gmailUser?.trim() || null
    if (d.testEmail !== undefined) data.testEmail = d.testEmail?.trim() || null
    if (d.enableSending !== undefined) data.enableSending = d.enableSending
    if (d.allowRealClientEmails !== undefined) data.allowRealClientEmails = d.allowRealClientEmails
    if (d.enableInboxSync !== undefined) data.enableInboxSync = d.enableInboxSync
    if (d.autoConfirmHighConfidencePayments !== undefined) data.autoConfirmHighConfidencePayments = d.autoConfirmHighConfidencePayments
    // Google shows the App Password with spaces ("abcd efgh ijkl mnop") — strip them.
    if (d.gmailAppPassword && d.gmailAppPassword.trim()) {
      data.gmailAppPassword = encryptSecret(d.gmailAppPassword.replace(/\s+/g, ''))
    }
    if (d.resendApiKey && d.resendApiKey.trim()) {
      data.resendApiKey = encryptSecret(d.resendApiKey.trim())
    }

    const existing = await getEmailSettingsRow()
    if (existing) {
      await prisma.emailSettings.update({ where: { id: existing.id }, data })
    } else {
      await prisma.emailSettings.create({ data })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Update email settings error:', error)
    return NextResponse.json({ error: 'Failed to save email settings' }, { status: 500 })
  }
}
