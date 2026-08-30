import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'
import { revalidatePath } from 'next/cache'

/**
 * Stop a consumable.
 *
 * Recurring charges are deactivated rather than deleted: the record is the
 * history of what was billed, and invoices already sent still reference that
 * period. Ad-hoc entries are deleted outright — they are a single line someone
 * added by hand, and an unsent invoice should lose it cleanly.
 *
 * Either way both sides go together, so a stopped charge can never leave the
 * cleaner's payback behind.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const row = await prisma.consumable.findUnique({ where: { id }, select: { id: true, kind: true } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (row.kind === 'ADHOC') {
      await prisma.consumable.delete({ where: { id } })
    } else {
      await prisma.consumable.update({ where: { id }, data: { isActive: false } })
    }

    revalidatePath('/invoices')
    revalidatePath('/payables')
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error stopping consumable:', error)
    return handleApiError(error, 'Failed to stop')
  }
}
