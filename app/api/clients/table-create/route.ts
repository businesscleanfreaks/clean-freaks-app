import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { parseDateOnlyForStorage } from "@/lib/date-only"
import { propertyTypeForClientPaymentRule } from "@/lib/client-payment-rules"
import { requireAuth } from "@/lib/auth"

export async function POST(request: Request) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json()
    const { name, ...rest } = body

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Client name is required" }, { status: 400 })
    }

    const data: Record<string, unknown> = {
      name: name.trim(),
      billingType: rest.billingType || "PER_CLEAN",
      cleanerPayType: rest.cleanerPayType || "PER_CLEAN",
    }

    const floatFields = [
      "clientPrice", "revenue", "cleanerPayout", "recurring",
      "addon1ClientPrice", "addon1CleanerPayout",
      "addon2ClientPrice", "addon2CleanerPayout",
    ]

    const stringFields = [
      "frequency", "cleanerAssignedId",
      "addon1Name", "addon1Frequency",
      "addon2Name", "addon2Frequency",
      "phone", "communicationContactName", "communicationEmail",
      "invoicingContactName", "invoicingEmail", "invoicingCcEmail", "invoiceFrequency", "propertyType", "paymentRulePreset", "notes",
    ]

    for (const f of floatFields) {
      if (rest[f] !== undefined && rest[f] !== null && rest[f] !== "") {
        const num = parseFloat(String(rest[f]))
        if (!isNaN(num)) data[f] = num
      }
    }

    for (const f of stringFields) {
      if (rest[f] !== undefined && rest[f] !== null && rest[f] !== "") {
        data[f] = String(rest[f])
      }
    }

    if (
      data.propertyType != null &&
      !["RESIDENTIAL", "COMMERCIAL"].includes(String(data.propertyType))
    ) {
      return NextResponse.json({ error: "Invalid property type" }, { status: 400 })
    }

    if (
      data.paymentRulePreset != null &&
      !["RESIDENTIAL_STANDARD", "COMMERCIAL_STANDARD"].includes(String(data.paymentRulePreset))
    ) {
      return NextResponse.json({ error: "Invalid payment rule preset" }, { status: 400 })
    }

    const presetPropertyType = propertyTypeForClientPaymentRule(data.paymentRulePreset as string | null | undefined)
    if (presetPropertyType) data.propertyType = presetPropertyType

    if (rest.startDate) {
      const d = parseDateOnlyForStorage(rest.startDate)
      if (d && !isNaN(d.getTime())) data.startDate = d
    }

    const client = await prisma.client.create({
      data: data as Prisma.ClientCreateInput,
      include: {
        cleanerAssigned: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      id: client.id,
      name: client.name,
      clientPrice: client.clientPrice,
      revenue: client.revenue,
      billingType: client.billingType,
      propertyType: client.propertyType,
      paymentRulePreset: client.paymentRulePreset,
      cleanerPayout: client.cleanerPayout,
      cleanerPayType: client.cleanerPayType,
      frequency: client.frequency,
      recurring: client.recurring,
      rowColor: client.rowColor,
      cleanerAssignedId: client.cleanerAssignedId,
      cleanerAssignedName: client.cleanerAssigned?.name ?? null,
      addon1Name: client.addon1Name,
      addon1ClientPrice: client.addon1ClientPrice,
      addon1Frequency: client.addon1Frequency,
      addon1CleanerPayout: client.addon1CleanerPayout,
      addon2Name: client.addon2Name,
      addon2ClientPrice: client.addon2ClientPrice,
      addon2Frequency: client.addon2Frequency,
      addon2CleanerPayout: client.addon2CleanerPayout,
      phone: client.phone,
      communicationContactName: client.communicationContactName,
      communicationEmail: client.communicationEmail,
      invoicingContactName: client.invoicingContactName,
      invoicingEmail: client.invoicingEmail,
      invoicingCcEmail: client.invoicingCcEmail,
      invoiceFrequency: client.invoiceFrequency,
      notes: client.notes,
      startDate: client.startDate?.toISOString() ?? null,
      isActive: client.isActive,
    }, { status: 201 })
  } catch (error) {
    console.error("Table create error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create client" },
      { status: 500 }
    )
  }
}
