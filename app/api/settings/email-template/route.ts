import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getEmailTemplate, DEFAULT_SUBJECT, DEFAULT_MESSAGE } from '@/lib/email-template'
import { logger } from '@/lib/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const templateSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(300, 'Subject too long'),
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
})

// GET — current template (+ the built-in defaults so the UI can offer a reset).
export async function GET() {
  try {
    await requireAuth()
    const template = await getEmailTemplate()
    return NextResponse.json({
      ...template,
      defaults: { subject: DEFAULT_SUBJECT, message: DEFAULT_MESSAGE },
    })
  } catch (error) {
    logger.error('Get email template error:', error)
    return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
  }
}

// PUT — upsert the singleton template.
export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const result = templateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.errors[0].message }, { status: 400 })
    }
    const existing = await prisma.emailTemplate.findFirst({ orderBy: { createdAt: 'asc' } })
    if (existing) {
      await prisma.emailTemplate.update({ where: { id: existing.id }, data: result.data })
    } else {
      await prisma.emailTemplate.create({ data: result.data })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Save email template error:', error)
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 })
  }
}
