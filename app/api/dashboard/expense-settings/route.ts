import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { requireAuth } from "@/lib/auth"
import { handleApiError } from "@/lib/api-error-handler"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

const projectedExpensesSchema = z.object({
  software: z.number().min(0).max(1_000_000),
  insurance: z.number().min(0).max(1_000_000),
  marketing: z.number().min(0).max(1_000_000),
  mistakes: z.number().min(0).max(1_000_000),
  freelancers: z.number().min(0).max(1_000_000),
  miscellaneous: z.number().min(0).max(1_000_000),
})

export type ProjectedExpenses = z.infer<typeof projectedExpensesSchema>

const emptyProjectedExpenses: ProjectedExpenses = {
  software: 0,
  insurance: 0,
  marketing: 0,
  mistakes: 0,
  freelancers: 0,
  miscellaneous: 0,
}

function isPendingMigration(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022"
}

export async function GET() {
  try {
    await requireAuth()
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { projectedExpenses: true },
    })
    const parsed = projectedExpensesSchema.safeParse(settings?.projectedExpenses)

    return NextResponse.json({
      projectedExpenses: parsed.success ? parsed.data : emptyProjectedExpenses,
    })
  } catch (error) {
    if (isPendingMigration(error)) {
      return NextResponse.json({ projectedExpenses: emptyProjectedExpenses, migrationPending: true })
    }
    return handleApiError(error, "Failed to load projected expenses")
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const result = projectedExpensesSchema.safeParse(await request.json())
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0]?.message || "Invalid projected expenses" },
        { status: 400 },
      )
    }

    await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", projectedExpenses: result.data },
      update: { projectedExpenses: result.data },
    })

    return NextResponse.json({ projectedExpenses: result.data })
  } catch (error) {
    if (isPendingMigration(error)) {
      return NextResponse.json(
        { error: "Projected expense settings will be available after the pending database migration is deployed." },
        { status: 503 },
      )
    }
    return handleApiError(error, "Failed to save projected expenses")
  }
}
