import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseDateOnlyForStorage } from "@/lib/date-only"
import {
  cadenceOverrideForClientPaymentRule,
  propertyTypeForClientPaymentRule,
} from "@/lib/client-payment-rules"

const ALLOWED_FIELDS = new Set([
  "clientPrice",
  "revenue",
  "cleanerPayout",
  "billingType",
  "propertyType",
  "paymentRulePreset",
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

    if (field === "propertyType") {
      if (value === null || value === "" || value === undefined) {
        processedValue = null
      } else if (value === "RESIDENTIAL" || value === "COMMERCIAL") {
        processedValue = value
      } else {
        return NextResponse.json({ error: "Invalid property type" }, { status: 400 })
      }
    }

    if (field === "paymentRulePreset") {
      if (value === null || value === "" || value === undefined) {
        processedValue = null
      } else if (value === "RESIDENTIAL_STANDARD" || value === "COMMERCIAL_STANDARD") {
        processedValue = value
      } else {
        return NextResponse.json({ error: "Invalid payment rule preset" }, { status: 400 })
      }
    }

    if (field === "startDate") {
      if (value === null || value === "" || value === undefined) {
        processedValue = null
      } else {
        const d = parseDateOnlyForStorage(value)
        if (!d || isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid date" }, { status: 400 })
        }
        processedValue = d
      }
    }

    const updateData: Record<string, unknown> = { [field]: processedValue }
    if (field === "paymentRulePreset") {
      const presetPropertyType = propertyTypeForClientPaymentRule(processedValue as string | null)
      if (presetPropertyType) updateData.propertyType = presetPropertyType
    }

    const updated = await prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id: resolvedParams.id },
        data: updateData,
        include: {
          cleanerAssigned: { select: { id: true, name: true } },
        },
      })

      if (field === "paymentRulePreset") {
        await tx.schedule.updateMany({
          where: { location: { clientId: resolvedParams.id } },
          data: {
            paymentCadenceOverride: cadenceOverrideForClientPaymentRule(processedValue as string | null),
          },
        })
      }

      return client
    })

    return NextResponse.json({
      success: true,
      cleanerAssignedName: updated.cleanerAssigned?.name ?? null,
      propertyType: updated.propertyType,
      paymentRulePreset: updated.paymentRulePreset,
    })
  } catch (error) {
    console.error("Table update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save" },
      { status: 500 }
    )
  }
}
