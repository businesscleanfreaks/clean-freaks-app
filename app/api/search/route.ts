import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await requireAuth()
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() || ''

  if (!q || q.length < 1) {
    return NextResponse.json(
      { clients: [], invoices: [], subcontractors: [], locations: [] },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    )
  }

  const [clients, invoices, subcontractors, locations] = await Promise.all([
    prisma.client.findMany({
      where: {
        name: { contains: q, mode: "insensitive" },
      },
      select: { id: true, name: true, phone: true, isActive: true },
      take: 6,
      orderBy: { name: 'asc' },
    }),
    prisma.invoice.findMany({
      where: {
        OR: [
          { invoiceNumber: { contains: q, mode: "insensitive" } },
          { client: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        client: { select: { name: true } },
      },
      take: 5,
      orderBy: { dateCreated: 'desc' },
    }),
    prisma.subcontractor.findMany({
      where: {
        name: { contains: q, mode: "insensitive" },
      },
      select: { id: true, name: true, phone: true },
      take: 5,
      orderBy: { name: 'asc' },
    }),
    prisma.location.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { address: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        address: true,
        client: { select: { id: true, name: true } },
      },
      take: 5,
      orderBy: { name: 'asc' },
    }),
  ])

  return NextResponse.json(
    { clients, invoices, subcontractors, locations },
    {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
      },
    }
  )
}
