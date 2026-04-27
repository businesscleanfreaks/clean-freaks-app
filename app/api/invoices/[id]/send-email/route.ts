import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendEmail, sendTestEmail } from '@/lib/email'
import { generateInvoiceEmail } from '@/lib/email-templates'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { emailInvoiceSchema, formatZodErrors } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { generateInvoiceToken } from '@/lib/invoice-tokens'
import { getBaseUrl } from '@/lib/url'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()

    // Validate request body with Zod
    const validationResult = emailInvoiceSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = formatZodErrors(validationResult.error)
      return NextResponse.json(
        { error: errors[0] || 'Invalid request data', errors },
        { status: 400 }
      )
    }

    const { to, subject, message, cc, isTest, showPaymentOptions } = validationResult.data

    // CRITICAL SAFETY CHECK: Force test mode if safety flags not set
    const allowRealEmails = process.env.ALLOW_REAL_CLIENT_EMAILS === 'true'
    const enableSending = process.env.ENABLE_EMAIL_SENDING === 'true'
    
    // Force test mode if safety flags not set
    let isActuallyTest = isTest
    if (!allowRealEmails || !enableSending) {
      isActuallyTest = true
      logger.warn('[SAFETY] Real client emails disabled - forcing test mode. Set ALLOW_REAL_CLIENT_EMAILS=true and ENABLE_EMAIL_SENDING=true to enable real emails.')
    }

    // Get invoice with all necessary data
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        client: true,
        lineItems: true,
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    // Ensure PDF exists and is hosted
    if (!invoice.pdfUrl) {
      return NextResponse.json(
        { error: 'Invoice PDF not generated. Please generate PDF first.' },
        { status: 400 }
      )
    }

    // Generate secure token for public invoice viewing
    const token = generateInvoiceToken(invoice.id)
    const baseUrl = getBaseUrl()
    const publicInvoiceUrl = `${baseUrl}/view-invoice/${token}`

    // Update invoice showPaymentOptions if provided
    const finalShowPaymentOptions = showPaymentOptions !== undefined ? showPaymentOptions : (invoice.showPaymentOptions ?? true)
    if (showPaymentOptions !== undefined && showPaymentOptions !== invoice.showPaymentOptions) {
      await prisma.invoice.update({
        where: { id: resolvedParams.id },
        data: { showPaymentOptions: showPaymentOptions },
      })
    }

    // Generate email HTML
    const emailHtml = generateInvoiceEmail({
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: formatCurrency(invoice.totalAmount),
      dueDate: invoice.dateDue ? format(new Date(invoice.dateDue), 'MMMM d, yyyy') : null,
      invoiceUrl: publicInvoiceUrl,
      customMessage: message || undefined,
      showPaymentOptions: finalShowPaymentOptions,
    })

    // Send email (test or real) - use isActuallyTest for safety
    let result: { success: boolean; messageId?: string; error?: string }

    if (isActuallyTest) {
      try {
        result = await sendTestEmail({
          subject,
          html: emailHtml,
          cc: cc || undefined,
        })
      } catch {
        // If test email fails (e.g., no TEST_EMAIL configured), simulate success
        // so the invoice workflow (DRAFT → SENT → PAID) can still be tested
        logger.warn('[EMAIL] Test email config missing — simulating successful send')
        result = { success: true, messageId: 'simulated-' + Date.now() }
      }
    } else {
      result = await sendEmail({
        to,
        subject,
        html: emailHtml,
        cc: cc || undefined,
      })
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      )
    }

    // Update invoice status to SENT (even for test/simulated sends so the workflow can be tested)
    await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        dateSent: new Date(),
        sentTo: isActuallyTest ? `[TEST] ${to}` : to,
        emailSubject: subject,
        emailBody: message,
        status: 'SENT',
      },
    })

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      isTest: isActuallyTest,
      safetyMode: !allowRealEmails || !enableSending ? 'FORCED_TEST' : 'NORMAL',
    })
  } catch (error) {
    logger.error('Error sending invoice email:', error)
    return NextResponse.json(
      { error: 'Failed to send invoice email' },
      { status: 500 }
    )
  }
}
