import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from '@/lib/auth'
import { businessDayKey } from "@/lib/business-time"
import { buildClientListFacts, type FactSchedule } from "@/lib/client-listing-facts"
import { areaFromAddress, firstArea } from "@/lib/address-area"

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The Clients page.
 *
 * Each client's status and money line are worked out HERE, from its schedules
 * and visits, by lib/client-listing-facts.ts · the page only formats them. This
 * used to send every job of every location to the browser and classify there.
 *
 * Read-only: it does not run the job-generation pass, so opening the Clients
 * page never writes anything. Upcoming cleans already exist from the daily
 * generator, which is all "next visit" needs.
 *
 * Fields are named rather than spread, so a column added to Client later is not
 * shipped to the browser by default.
 */
export async function GET() {
  try {
    // Defence in depth. These read routes were protected by middleware alone,
    // so any change to the matcher · or any path that reaches the handler
    // another way · exposed client and financial data with nothing else in the
    // way. The session check belongs with the data, not only in front of it.
    await requireAuth()

    const todayKey = businessDayKey(new Date()) as string
    const today = new Date(`${todayKey}T12:00:00.000Z`)
    const dayStart = new Date(`${todayKey}T00:00:00.000Z`)

    const [clients, lastByLocation, nextByLocation, nearbyVisits] = await Promise.all([
      prisma.client.findMany({
        select: {
          id: true,
          name: true,
          phone: true,
          communicationEmail: true,
          communicationContactName: true,
          invoicingEmail: true,
          billingType: true,
          propertyType: true,
          notes: true,
          isActive: true,
          createdAt: true,
          startDate: true,
          contacts: {
            select: { name: true, billingRole: true, isPrimary: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 1,
          },
          locations: {
            select: {
              id: true,
              name: true,
              address: true,
              latitude: true,
              longitude: true,
              schedules: {
                select: {
                  isActive: true,
                  startDate: true,
                  endDate: true,
                  pauseFrom: true,
                  pauseTo: true,
                  frequency: true,
                  daysOfWeek: true,
                  monthlyPattern: true,
                  customDates: true,
                  excludedDates: true,
                  cadenceAnchor: true,
                  defaultClientRate: true,
                  clientPayType: true,
                  subcontractor: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      // The last visit, however long ago · a lapsed client shows "last Mar 3".
      prisma.job.groupBy({
        by: ['locationId'],
        where: { status: { not: 'CANCELLED' }, date: { lt: dayStart } },
        _max: { date: true },
      }),
      // The next visit, however far ahead.
      prisma.job.groupBy({
        by: ['locationId'],
        where: { status: { not: 'CANCELLED' }, date: { gte: dayStart } },
        _min: { date: true },
      }),
      // Visits near today, for what they are charged and the 90-day total.
      prisma.job.findMany({
        where: {
          status: { not: 'CANCELLED' },
          date: {
            gte: new Date(dayStart.getTime() - 90 * DAY_MS),
            lt: new Date(dayStart.getTime() + 180 * DAY_MS),
          },
        },
        select: {
          locationId: true,
          date: true,
          clientRate: true,
          subcontractor: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
      }),
    ])

    const lastMap = new Map(lastByLocation.map(r => [r.locationId, r._max.date]))
    const nextMap = new Map(nextByLocation.map(r => [r.locationId, r._min.date]))
    const nearbyMap = new Map<string, typeof nearbyVisits>()
    for (const visit of nearbyVisits) {
      const list = nearbyMap.get(visit.locationId) ?? []
      list.push(visit)
      nearbyMap.set(visit.locationId, list)
    }

    const serializedClients = clients.map(client => {
      const locationIds = client.locations.map(l => l.id)
      const latest = (dates: (Date | null | undefined)[], pick: 'max' | 'min') =>
        dates.filter((d): d is Date => !!d).reduce<Date | null>(
          (best, d) => (!best ? d : pick === 'max' ? (d > best ? d : best) : (d < best ? d : best)),
          null,
        )

      const schedules: FactSchedule[] = client.locations.flatMap(loc =>
        loc.schedules.map(s => ({
          isActive: s.isActive,
          startDate: s.startDate,
          endDate: s.endDate,
          pauseFrom: s.pauseFrom,
          pauseTo: s.pauseTo,
          frequency: s.frequency,
          daysOfWeek: s.daysOfWeek,
          monthlyPattern: s.monthlyPattern,
          customDates: s.customDates,
          excludedDates: s.excludedDates,
          cadenceAnchor: s.cadenceAnchor,
          defaultClientRate: s.defaultClientRate,
          clientPayType: s.clientPayType,
          cleanerName: s.subcontractor?.name ?? null,
        }))
      )

      const { facts, cleaner } = buildClientListFacts(
        {
          isActive: client.isActive,
          notes: client.notes,
          billingType: client.billingType,
          schedules,
          lastVisit: latest(locationIds.map(id => lastMap.get(id)), 'max'),
          nextVisit: latest(locationIds.map(id => nextMap.get(id)), 'min'),
          nearbyVisits: locationIds
            .flatMap(id => nearbyMap.get(id) ?? [])
            .map(v => ({ date: v.date, clientRate: v.clientRate, cleanerName: v.subcontractor?.name ?? null })),
        },
        today,
      )

      const primaryContact = client.contacts[0]
      const area = firstArea(client.locations.map(l => l.address))

      return {
        id: client.id,
        name: client.name,
        phone: client.phone,
        communicationEmail: client.communicationEmail,
        communicationContactName: client.communicationContactName,
        invoicingEmail: client.invoicingEmail,
        billingType: client.billingType,
        propertyType: client.propertyType,
        isActive: client.isActive,
        createdAt: client.createdAt.toISOString(),
        startDate: client.startDate?.toISOString() ?? null,
        locations: client.locations.map(loc => ({
          id: loc.id,
          name: loc.name,
          address: loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
          area: areaFromAddress(loc.address),
        })),
        primaryArea: area,
        listing: {
          facts,
          cleaner,
          contactName: primaryContact?.name ?? client.communicationContactName ?? null,
          contactRole: primaryContact?.billingRole ?? null,
        },
      }
    })

    return NextResponse.json(serializedClients, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
      },
    })
  } catch (error) {
    console.error('Clients data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}
