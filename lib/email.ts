/**
 * Email Service Abstraction Layer
 * Supports Gmail (nodemailer) and Resend (REST API) — provider + credentials are
 * resolved at send time from getEmailConfig() (Settings → Email DB row, with env
 * fallback), so the sending account can be changed in-app without a redeploy.
 */

import nodemailer from 'nodemailer'
import { getEmailConfig, type EmailConfig } from '@/lib/email-settings'

export interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  cc?: string | string[]
  attachments?: {
    filename: string
    path?: string
    href?: string
  }[]
}

export interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
  warning?: string
}

/**
 * Send an email using the configured provider
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const config = await getEmailConfig()

  // CRITICAL SAFETY CHECK: don't send to real clients unless both flags are on.
  if (!config.allowRealClientEmails || !config.enableSending) {
    console.log('[EMAIL] SAFETY: Real client emails disabled. Email would have been sent:')
    console.log('  To:', options.to)
    console.log('  Subject:', options.subject)
    console.log('  Provider:', config.provider)
    console.log('  [SAFETY] Not sending (enable in Settings → Email)')
    return {
      success: true,
      messageId: 'safety-test-mode-' + Date.now(),
    }
  }

  try {
    return await dispatch(config.provider, options, config)
  } catch (error) {
    console.error('[EMAIL] Send failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    }
  }
}

function dispatch(provider: string, options: EmailOptions, config: EmailConfig): Promise<EmailResult> {
  if (provider === 'gmail') return sendViaGmail(options, config)
  if (provider === 'resend') return sendViaResend(options, config)
  throw new Error(`Unknown email provider: ${provider}`)
}

/**
 * Send email via Gmail / Google Workspace using Nodemailer + an App Password
 */
async function sendViaGmail(options: EmailOptions, config: EmailConfig): Promise<EmailResult> {
  const user = config.gmailUser
  const pass = config.gmailAppPassword

  if (!user || !pass) {
    throw new Error('Gmail credentials not configured. Add a sending address and App Password in Settings → Email.')
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  // Prefer an explicit From address; otherwise reuse the auth user (mapping the
  // legacy admin@ login to the invoices@ alias for backwards compatibility).
  const fromAddress =
    config.fromEmail ||
    (user === 'admin@thecleanfreaks.co' ? 'invoices@thecleanfreaks.co' : user)
  const fromName = config.fromName || 'Clean Freaks'

  const info = await transporter.sendMail({
    from: `${fromName} <${fromAddress}>`,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    html: options.html,
    text: options.text || stripHtml(options.html),
    attachments: options.attachments,
  })

  console.log('[EMAIL] Gmail sent successfully:', info.messageId)

  return {
    success: true,
    messageId: info.messageId,
  }
}

/**
 * Send email via Resend's REST API (no SDK dependency). The From address must be
 * on a domain verified in the Resend dashboard.
 */
async function sendViaResend(options: EmailOptions, config: EmailConfig): Promise<EmailResult> {
  const apiKey = config.resendApiKey

  if (!apiKey) {
    throw new Error('Resend API key not configured. Add it in Settings → Email.')
  }
  if (!config.fromEmail) {
    throw new Error('A "From" email on your verified Resend domain is required. Set it in Settings → Email.')
  }

  // Resend wants attachment bytes inline as base64.
  const attachments = options.attachments
    ? await Promise.all(
        options.attachments.map(async (a) => {
          let content = ''
          if (a.href) {
            const r = await fetch(a.href)
            content = Buffer.from(await r.arrayBuffer()).toString('base64')
          } else if (a.path) {
            const fs = await import('fs/promises')
            content = (await fs.readFile(a.path)).toString('base64')
          }
          return { filename: a.filename, content }
        })
      )
    : undefined

  const toArr = Array.isArray(options.to) ? options.to : [options.to]
  const ccArr = options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${config.fromName || 'Clean Freaks'} <${config.fromEmail}>`,
      to: toArr,
      cc: ccArr,
      subject: options.subject,
      html: options.html,
      text: options.text || stripHtml(options.html),
      attachments,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
  if (!res.ok) {
    throw new Error(data?.message || data?.name || `Resend API error (${res.status})`)
  }

  console.log('[EMAIL] Resend sent successfully:', data?.id)
  return {
    success: true,
    messageId: data?.id,
  }
}

/**
 * Send a test email to the configured test address.
 * Test emails bypass the ALLOW_REAL_CLIENT_EMAILS check since they only ever go
 * to the operator's own test inbox — but still require sending to be enabled.
 */
export async function sendTestEmail(
  options: Omit<EmailOptions, 'to'>,
  opts?: { force?: boolean },
): Promise<EmailResult> {
  const config = await getEmailConfig()

  if (!config.testEmail) {
    throw new Error('Test email address not set. Add one in Settings → Email.')
  }

  // The Settings "Send test" passes force:true so credentials can be verified
  // before the master switch is flipped on (test mail only goes to testEmail).
  if (!config.enableSending && !opts?.force) {
    console.log('[EMAIL] Test email sending is DISABLED. Would have sent to:', config.testEmail)
    return {
      success: true,
      messageId: 'test-mode-disabled-' + Date.now(),
      warning: 'SENDING_DISABLED',
    }
  }

  console.log('[EMAIL] Sending test email to:', config.testEmail)

  try {
    return await dispatch(config.provider, {
      ...options,
      to: config.testEmail,
      subject: `[TEST] ${options.subject}`,
    }, config)
  } catch (error) {
    console.error('[EMAIL] Test email send failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email',
    }
  }
}

/**
 * Simple HTML to plain text converter
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}
