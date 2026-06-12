import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"

const DAY = 86_400_000

/**
 * Cross-month aging list: every SENT, unpaid invoice whose due date has passed,
 * regardless of service month. Shaped like an invoice "candidate" so it flows
 * through the same workspace list/detail/composer, plus an `overdueDays` field.
 * Due date = dateDue, else 14 days after it was sent (or created).
 */
export async function GET() {
  try {
    const now = Date.now()
    const sent = await prisma.invoice.findMany({
      where: { status: "SENT", datePaid: null },
      include: { client: { select: { id: true, name: true, billingType: true } } },
      orderBy: { dateDue: "asc" },
    })

    const candidates = sent
      .map((inv) => {
        const base = inv.dateDue ?? new Date((inv.dateSent ?? inv.dateCreated).getTime() + 14 * DAY)
        return { inv, due: base, overdueDays: Math.floor((now - base.getTime()) / DAY) }
      })
      .filter((x) => x.overdueDays > 0)
      .sort((a, b) => b.overdueDays - a.overdueDays)
      .map(({ inv, due, overdueDays }) => ({
        candidateId: inv.id,
        clientId: inv.clientId,
        clientName: inv.client.name,
        billingType: inv.client.billingType,
        status: "SENT" as const,
        scheduleSummary: "",
        lineItems: [] as never[],
        exceptions: [] as never[],
        total: inv.totalAmount,
        existingInvoiceId: inv.id,
        existingInvoiceNumber: inv.invoiceNumber,
        existingInvoiceStatus: "SENT",
        jobCount: 0,
        completedCount: 0,
        hasEmail: !!inv.sentTo,
        jobIds: [] as string[],
        overdueDays,
        dueDateIso: due.toISOString(),
        sentDateIso: inv.dateSent?.toISOString() ?? null,
      }))

    return NextResponse.json({ candidates })
  } catch (error) {
    logger.error("Error loading overdue invoices:", error)
    return NextResponse.json({ candidates: [], error: "Failed to load overdue invoices" }, { status: 500 })
  }
}
