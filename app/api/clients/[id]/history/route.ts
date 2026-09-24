import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { businessDayKey } from '@/lib/business-time'
import { buildHistory } from '@/lib/client-history'

export const dynamic = 'force-dynamic'

const noonOf = (key: string) => new Date(`${key}T12:00:00.000Z`)

/**
 * The profile's History tab: every month since the client started, visits per
 * cleaner and the exceptions under each. The profile itself only loads a few
 * months of cleans, so this reads the full record. Read-only; the month
 * sections are worked out by lib/client-history.ts.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const client = await prisma.client.findUnique({
      where: { id: params.id },
      select: {
        startDate: true,
        createdAt: true,
        clientNotes: { select: { text: true, createdAt: true } },
        locations: {
          select: {
            id: true,
            name: true,
            schedules: {
              select: {
                id: true,
                startDate: true,
                endDate: true,
                cadenceAnchor: true,
                pauseFrom: true,
                pauseTo: true,
                frequency: true,
                daysOfWeek: true,
                monthlyPattern: true,
                customDates: true,
                defaultClientRate: true,
                clientPayType: true,
                subcontractor: { select: { name: true } },
              },
            },
            jobs: {
              select: {
                id: true,
                date: true,
                status: true,
                scheduleId: true,
                clientRate: true,
                notes: true,
                subcontractor: { select: { name: true } },
                vendor: { select: { name: true } },
                addOnServices: { select: { description: true } },
              },
            },
          },
        },
      },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const today = noonOf(businessDayKey(new Date()) as string)
    const months = buildHistory({
      today,
      since: client.startDate ?? null,
      schedules: client.locations.flatMap(loc =>
        loc.schedules.map(s => ({
          ...s,
          locationId: loc.id,
          locationName: loc.name,
          cleanerName: s.subcontractor?.name ?? null,
        })),
      ),
      jobs: client.locations.flatMap(loc =>
        loc.jobs.map(j => ({
          id: j.id,
          date: j.date,
          status: j.status,
          locationName: loc.name,
          scheduleId: j.scheduleId,
          cleanerName: j.subcontractor?.name ?? j.vendor?.name ?? null,
          clientRate: j.clientRate,
          notes: j.notes,
          addOnNames: j.addOnServices.map(a => a.description),
        })),
      ),
      notes: client.clientNotes.map(n => ({ day: noonOf(businessDayKey(n.createdAt) as string), text: n.text })),
    })

    return NextResponse.json({ months })
  } catch (error) {
    console.error('Client history error:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
