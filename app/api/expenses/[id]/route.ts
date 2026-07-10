import { NextResponse } from "next/server"
import { handleApiError } from "@/lib/api-error-handler"
import { requireAuth } from "@/lib/auth"
import { parseDateOnlyForStorage } from "@/lib/date-only"
import { prisma } from "@/lib/db"
import { updateExpenseSchema } from "@/lib/validations"

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAuth()
    const result = updateExpenseSchema.safeParse(await request.json())
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0]?.message || "Invalid expense" },
        { status: 400 },
      )
    }

    const { date, ...data } = result.data
    const parsedDate = date === undefined ? undefined : parseDateOnlyForStorage(date)
    if (date !== undefined && !parsedDate) throw new Error("Expense date is required")

    const expense = await prisma.expense.update({
      where: { id: params.id },
      data: { ...data, ...(parsedDate ? { date: parsedDate } : {}) },
    })
    return NextResponse.json({ expense })
  } catch (error) {
    return handleApiError(error, "Failed to update expense")
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAuth()
    await prisma.expense.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, "Failed to delete expense")
  }
}
