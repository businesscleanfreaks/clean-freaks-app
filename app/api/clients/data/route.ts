import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = 'force-dynamic'

// Clients data API for instant page loads
export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            accessInfo: true,
            schedules: {
              where: { isActive: true },
              select: {
                subcontractor: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    })
    
    // Serialize dates and compute cleaner display for each client
    const serializedClients = clients.map(client => {
      // Gather all unique assigned cleaner names from active schedules
      const cleanerNames = new Set<string>()
      let hasSchedules = false
      for (const loc of client.locations) {
        for (const sch of loc.schedules) {
          hasSchedules = true
          if (sch.subcontractor?.name) {
            cleanerNames.add(sch.subcontractor.name)
          }
        }
      }

      let cleanerDisplay = 'Unassigned'
      if (cleanerNames.size === 1) {
        cleanerDisplay = [...cleanerNames][0]
      } else if (cleanerNames.size > 1) {
        cleanerDisplay = 'Mixed'
      } else if (!hasSchedules) {
        cleanerDisplay = 'Unassigned'
      }

      // Strip schedules from locations for backward compat
      const locationsClean = client.locations.map(({ schedules: _s, ...rest }) => rest)

      return {
        ...client,
        createdAt: client.createdAt.toISOString(),
        locations: locationsClean,
        cleanerDisplay,
      }
    })

    return NextResponse.json(serializedClients)
  } catch (error) {
    console.error('Clients data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}
