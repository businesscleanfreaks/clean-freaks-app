import { endOfMonth, format, startOfMonth, subMonths } from "date-fns"
import { NextRequest, NextResponse } from "next/server"
import { handleApiError } from "@/lib/api-error-handler"
import { requireAuth } from "@/lib/auth"
import { parseDateOnlyForStorage } from "@/lib/date-only"
import { prisma } from "@/lib/db"
import { createExpenseSchema } from "@/lib/validations"

export const dynamic = "force-dynamic"

function selectedMonth(request: NextRequest) {
  const now = new Date()
  const year = Number(new URL(request.url).searchParams.get("year") ?? now.getFullYear())
  const month = Number(new URL(request.url).searchParams.get("month") ?? now.getMonth())
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error("Invalid dashboard month")
  }
  return new Date(year, month, 1)
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const selected = selectedMonth(request)
    const selectedStart = startOfMonth(selected)
    const selectedEnd = endOfMonth(selected)
    const rangeStart = startOfMonth(subMonths(selected, 5))

    const rows = await prisma.expense.findMany({
      where: {
        isCleanerPay: false,
        OR: [
          { isRecurring: true, date: { lte: selectedEnd } },
          { isRecurring: false, date: { gte: rangeStart, lte: selectedEnd } },
        ],
      },
      orderBy: [{ isRecurring: "desc" }, { date: "desc" }, { description: "asc" }],
    })

    const months = Array.from({ length: 6 }, (_, index) => startOfMonth(subMonths(selected, 5 - index))).map((monthStart) => {
      const monthEnd = endOfMonth(monthStart)
      const total = rows.reduce((sum, row) => {
        const applies = row.isRecurring
          ? row.date <= monthEnd
          : row.date >= monthStart && row.date <= monthEnd
        return applies ? sum + row.amount : sum
      }, 0)
      return { key: format(monthStart, "yyyy-MM"), label: format(monthStart, "MMM"), total }
    })

    const expenses = rows
      .filter((row) => row.isRecurring || (row.date >= selectedStart && row.date <= selectedEnd))   // selected month/range (current month)
      .map((row) => ({
        id: row.id,
        date: format(row.date, "yyyy-MM-dd"),
        amount: row.amount,
        description: row.description,
        category: row.category,
        type: row.type,
        vendor: row.vendor,
        notes: row.notes,
        isRecurring: row.isRecurring,
      }))

    return NextResponse.json({
      expenses,
      months,
      total: months.at(-1)?.total ?? 0,   
      period: format(selected, "yyyy-MM"),           
    })
  } catch (error) {
    return handleApiError(error, "Failed to load expenses")
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const result = createExpenseSchema.safeParse(await request.json())
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0]?.message || "Invalid expense" },
        { status: 400 },
      )
    }

    const { date, ...data } = result.data
    const parsedDate = parseDateOnlyForStorage(date)
    if (!parsedDate) throw new Error("Expense date is required")

    const expense = await prisma.expense.create({ data: { ...data, date: parsedDate } })
    return NextResponse.json({ expense }, { status: 201 })

  } catch (error) {
    return handleApiError(error, "Failed to add expense")
  }
}
