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
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    })
    
    // Serialize dates to strings for client components
    const serializedClients = clients.map(client => ({
      ...client,
      createdAt: client.createdAt.toISOString(),
    }))

    return NextResponse.json(serializedClients)
  } catch (error) {
    console.error('Clients data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}
