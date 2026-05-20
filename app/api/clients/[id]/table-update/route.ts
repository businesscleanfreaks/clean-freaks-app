import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const ALLOWED_FIELDS = new Set([
  "clientPrice",
  "revenue",
  "cleanerPayout",
  "billingType",
  "cleanerPayType",
  "frequency",
  "recurring",
  "rowColor",
  "cleanerAssignedId",
  "addon1Name",
  "addon1ClientPrice",
  "addon1Frequency",
  "addon1CleanerPayout",
  "addon2Name",
  "addon2ClientPrice",
  "addon2Frequency",
  "addon2CleanerPayout",
  "name",
  "phone",
  "communicationContactName",
  "communicationEmail",
  "invoicingContactName",
  "invoicingEmail",
  "invoicingCcEmail",
  "invoiceFrequency",
  "preferredPaymentMethod",
  "notes",
  "startDate",
])

const FLOAT_FIELDS = new Set([
  "clientPrice",
  "revenue",
  "cleanerPayout",
  "recurring",
  "addon1ClientPrice",
  "addon1CleanerPayout",
  "addon2ClientPrice",
  "addon2CleanerPayout",
])

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const resolvedParams = await params
    const body = await request.json()
    const { field, value } = body

    if (!field || !ALLOWED_FIELDS.has(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 })
    }

    let processedValue = value

    if (FLOAT_FIELDS.has(field)) {
      if (value === null || value === "" || value === undefined) {
        processedValue = null
      } else {
        const num = parseFloat(String(value))
        if (isNaN(num)) {
          return NextResponse.json({ error: "Invalid number" }, { status: 400 })
        }
        processedValue = num
      }
    }

    if (field === "cleanerAssignedId" && (value === "" || value === "unassigned")) {
      processedValue = null
    }

    if (field === "startDate") {
      if (value === null || value === "" || value === undefined) {
        processedValue = null
      } else {
        const d = new Date(value)
        if (isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid date" }, { status: 400 })
        }
        processedValue = d
      }
    }

    const updated = await prisma.client.update({
      where: { id: resolvedParams.id },
      data: { [field]: processedValue },
      include: {
        cleanerAssigned: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      cleanerAssignedName: updated.cleanerAssigned?.name ?? null,
    })
  } catch (error) {
    console.error("Table update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save" },
      { status: 500 }
    )
  }
}
