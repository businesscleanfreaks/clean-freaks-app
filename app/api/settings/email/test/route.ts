import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sendTestEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// POST — send a test email using the currently saved config (forced so it works
// even before "Enable sending" is on; it only ever goes to the test address).
export async function POST() {
  try {
    await requireAuth()
    const result = await sendTestEmail(
      {
        subject: 'Clean Freaks email test',
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#0D9488;margin:0 0 8px">✅ Email is working</h2>
          <p style="color:#334155;font-size:14px;line-height:1.6;margin:0">
            This is a test from your Clean Freaks <strong>Settings → Email</strong> page.
            If you received it, your sending credentials are valid.
          </p>
        </div>`,
      },
      { force: true },
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Send failed' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, messageId: result.messageId })
  } catch (error) {
    logger.error('Test email error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send test email' },
      { status: 500 },
    )
  }
}
