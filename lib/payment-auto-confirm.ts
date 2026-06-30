import { prisma } from '@/lib/db'
import { markInvoicePaid } from '@/lib/mark-invoice-paid'
import { normalizeSenderName } from '@/lib/payment-matching'

export interface AutoConfirmResult {
  applied: number
  skipped: number
}

export async function autoConfirmHighConfidenceMatches(
  db: typeof prisma = prisma,
): Promise<AutoConfirmResult> {
  const matches = await db.paymentMatch.findMany({
    where: {
      status: 'NEEDS_REVIEW',
      confidence: 'HIGH',
      matchedInvoiceId: { not: null },
    },
    select: { id: true },
  })

  let applied = 0
  let skipped = 0

  for (const { id } of matches) {
    const result = await db.$transaction(async (tx) => {
      const match = await tx.paymentMatch.findUnique({
        where: { id },
        include: {
          matchedInvoice: { select: { id: true, clientId: true, status: true } },
        },
      })

      if (
        !match ||
        match.status !== 'NEEDS_REVIEW' ||
        match.confidence !== 'HIGH' ||
        !match.matchedInvoiceId ||
        !match.matchedInvoice ||
        match.matchedInvoice.status === 'PAID'
      ) {
        return 'skipped' as const
      }

      const paid = await markInvoicePaid(tx, match.matchedInvoiceId, {
        method: 'ZELLE',
        confirmationNumber: match.confirmationNumber,
        receivedAt: match.receivedAt,
        notes: `Auto-confirmed Zelle payment from ${match.senderName}`,
      })

      if (paid.status !== 'PAID') return 'skipped' as const

      await tx.paymentMatch.update({
        where: { id: match.id },
        data: { status: 'AUTO_APPLIED', matchedInvoiceId: match.matchedInvoiceId },
      })

      const normalized = normalizeSenderName(match.senderName)
      await tx.clientPaymentAlias.upsert({
        where: { normalizedSenderName: normalized },
        create: { normalizedSenderName: normalized, clientId: match.matchedInvoice.clientId },
        update: { clientId: match.matchedInvoice.clientId },
      })

      return 'applied' as const
    })

    if (result === 'applied') applied++
    else skipped++
  }

  return { applied, skipped }
}
