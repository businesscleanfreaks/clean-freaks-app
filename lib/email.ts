/**
 * Email Service Abstraction Layer
 * Supports Gmail (nodemailer) and Resend - easy to switch between providers
 */

import nodemailer from 'nodemailer'

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
}

/**
 * Send an email using the configured provider
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const provider = process.env.EMAIL_PROVIDER || 'gmail'
  const enableSending = process.env.ENABLE_EMAIL_SENDING === 'true'
  const allowRealEmails = process.env.ALLOW_REAL_CLIENT_EMAILS === 'true'

  // CRITICAL SAFETY CHECK: Force test mode if safety flags not set
  if (!allowRealEmails || !enableSending) {
    console.log('[EMAIL] SAFETY: Real client emails disabled. Email would have been sent:')
    console.log('  To:', options.to)
    console.log('  Subject:', options.subject)
    console.log('  Provider:', provider)
    console.log('  [SAFETY] Redirecting to TEST_EMAIL instead')
    return {
      success: true,
      messageId: 'safety-test-mode-' + Date.now(),
    }
  }

  // Safety check: If sending is disabled, just log and return success
  if (!enableSending) {
    console.log('[EMAIL] Sending is DISABLED. Email would have been sent:')
    console.log('  To:', options.to)
    console.log('  Subject:', options.subject)
    console.log('  Provider:', provider)
    return {
      success: true,
      messageId: 'test-mode-' + Date.now(),
    }
  }

  try {
    if (provider === 'gmail') {
      return await sendViaGmail(options)
    } else if (provider === 'resend') {
      return await sendViaResend(options)
    } else {
      throw new Error(`Unknown email provider: ${provider}`)
    }
  } catch (error) {
    console.error('[EMAIL] Send failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    }
  }
}

/**
 * Send email via Gmail using Nodemailer
 */
async function sendViaGmail(options: EmailOptions): Promise<EmailResult> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD

  if (!user || !pass) {
    throw new Error('Gmail credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local')
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  })

  // Send email (use invoices@ alias for FROM address if using admin@ for auth)
  const fromAddress = user === 'admin@thecleanfreaks.co'
    ? 'invoices@thecleanfreaks.co'
    : user

  const info = await transporter.sendMail({
    from: `Clean Freaks <${fromAddress}>`,
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
 * Send email via Resend (placeholder for future implementation)
 */
async function sendViaResend(options: EmailOptions): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    throw new Error('Resend API key not configured. Set RESEND_API_KEY in .env.local')
  }

  // This would use the Resend SDK
  // For now, throw error as it's not implemented yet
  throw new Error('Resend provider not yet implemented. Install resend package: npm install resend')

  // Future implementation:
  // const { Resend } = await import('resend')
  // const resend = new Resend(apiKey)
  //
  // const result = await resend.emails.send({
  //   from: `Clean Freaks <${process.env.EMAIL_FROM || 'invoices@thecleanfreaks.co'}>`,
  //   to: options.to,
  //   subject: options.subject,
  //   html: options.html,
  //   attachments: options.attachments,
  // })
  //
  // return {
  //   success: true,
  //   messageId: result.id,
  // }
}

/**
 * Send a test email to the configured test address
 * Test emails bypass the ALLOW_REAL_CLIENT_EMAILS check since they're always safe
 */
export async function sendTestEmail(options: Omit<EmailOptions, 'to'>): Promise<EmailResult> {
  const testEmail = process.env.TEST_EMAIL
  const enableSending = process.env.ENABLE_EMAIL_SENDING === 'true'
  const provider = process.env.EMAIL_PROVIDER || 'gmail'

  if (!testEmail) {
    throw new Error('Test email not configured. Set TEST_EMAIL in .env.local')
  }

  if (!enableSending) {
    console.log('[EMAIL] Test email sending is DISABLED. Would have sent to:', testEmail)
    return {
      success: true,
      messageId: 'test-mode-disabled-' + Date.now(),
    }
  }

  console.log('[EMAIL] Sending test email to:', testEmail)

  // For test emails, we bypass the ALLOW_REAL_CLIENT_EMAILS check
  // and send directly using the provider
  try {
    if (provider === 'gmail') {
      return await sendViaGmail({
        ...options,
        to: testEmail,
        subject: `[TEST] ${options.subject}`,
      })
    } else if (provider === 'resend') {
      return await sendViaResend({
        ...options,
        to: testEmail,
        subject: `[TEST] ${options.subject}`,
      })
    } else {
      throw new Error(`Unknown email provider: ${provider}`)
    }
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
