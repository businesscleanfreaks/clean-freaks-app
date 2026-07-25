import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { validateRemoval } from '@/lib/team'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const currentUser = await requireAuth()
    const { id } = await Promise.resolve(params)

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    // Count inside the same request so the "last account" guard reflects reality.
    const totalUserCount = await prisma.user.count()
    const guardError = validateRemoval({
      targetUserId: id,
      currentUserId: currentUser.id,
      totalUserCount,
    })
    if (guardError) {
      return NextResponse.json({ error: guardError }, { status: 400 })
    }

    await prisma.user.delete({ where: { id } })

    logger.info(`[team] teammate removed: ${target.email}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'Failed to remove teammate')
  }
}
