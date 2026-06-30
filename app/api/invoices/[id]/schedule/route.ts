import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

export const dynamic = 'force-dynamic'

const scheduleSchema = z.object({
  scheduledSendAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid scheduled date/time'),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.string().optional(),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  showPaymentOptions: z.boolean().optional(),
})

// POST: schedule this invoice's email to auto-send at a future time.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()

    const { id } = await Promise.resolve(params)
    const parsed = scheduleSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid request' }, { status: 400 })
    }

    const { scheduledSendAt, to, cc, subject, message, showPaymentOptions } = parsed.data
    const toArr = (Array.isArray(to) ? to : [to]).map((t) => t.trim()).filter(Boolean)
    if (toArr.length === 0) {
      return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
    }

    const when = new Date(scheduledSendAt)
    if (when.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (invoice.status === 'SENT' || invoice.status === 'PAID') {
      return NextResponse.json({ error: 'Invoice has already been sent' }, { status: 400 })
    }

    const payload: Record<string, unknown> = {
      to: toArr,
      subject,
      message,
      showPaymentOptions: showPaymentOptions ?? true,
    }
    if (cc && cc.trim()) payload.cc = cc.trim()

    await prisma.invoice.update({
      where: { id },
      data: {
        scheduledSendAt: when,
        scheduledPayload: payload as Prisma.InputJsonValue,
      },
    })

    revalidatePath('/invoices')
    return NextResponse.json({ success: true, scheduledSendAt: when.toISOString() })
  } catch (error) {
    logger.error('Error scheduling invoice send:', error)
    return handleApiError(error, 'Failed to schedule send')
  }
}

// DELETE: cancel a pending scheduled send.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()

    const { id } = await Promise.resolve(params)
    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    await prisma.invoice.update({
      where: { id },
      data: { scheduledSendAt: null, scheduledPayload: Prisma.DbNull },
    })

    revalidatePath('/invoices')
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error cancelling scheduled send:', error)
    return handleApiError(error, 'Failed to cancel scheduled send')
  }
}
