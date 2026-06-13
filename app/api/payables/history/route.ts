import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/payables/history?type=cleaner|vendor&id=<id>
 * A person's recent payments (the statement Payables shows when one is selected),
 * so cleaner/vendor history lives here instead of the separate detail pages.
 */
export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const id = searchParams.get("id")
    if (!id || (type !== "cleaner" && type !== "vendor")) {
      return NextResponse.json({ error: "type (cleaner|vendor) and id are required" }, { status: 400 })
    }

    if (type === "cleaner") {
      const payments = await prisma.subcontractorPayment.findMany({
        where: { subcontractorId: id },
        orderBy: { datePaid: "desc" },
        take: 60,
        include: { _count: { select: { lineItems: true } } },
      })
      return NextResponse.json({
        payments: payments.map((p) => ({
          id: p.id,
          datePaid: p.datePaid.toISOString(),
          amount: p.totalAmount,
          method: p.paymentMethod,
          notes: p.notes,
          count: p._count.lineItems,
        })),
        total: payments.reduce((s, p) => s + p.totalAmount, 0),
      })
    }

    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId: id },
      orderBy: { datePaid: "desc" },
      take: 60,
      include: { _count: { select: { lineItems: true } } },
    })
    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        datePaid: p.datePaid.toISOString(),
        amount: p.totalAmount,
        method: null as string | null,
        notes: p.notes,
        count: p._count.lineItems,
      })),
      total: payments.reduce((s, p) => s + p.totalAmount, 0),
    })
  } catch (error) {
    console.error("Payables history error:", error)
    return NextResponse.json({ payments: [], total: 0, error: "Failed to load history" }, { status: 500 })
  }
}
