import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createClient } from '@/app/api/clients/route'
import { PUT as updateClient } from '@/app/api/clients/[id]/route'
import { GET as getClientsData } from '@/app/api/clients/data/route'
import { GET as getTableData } from '@/app/api/clients/table-data/route'
import { POST as createSchedule } from '@/app/api/schedules/route'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const jsonReq = (url: string, method: 'POST' | 'PUT', body: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('client property type', () => {
  it('round-trips residential/commercial type and pay-rule preset through client routes', async () => {
    const createResponse = await createClient(jsonReq('http://test/api/clients', 'POST', {
      name: 'Property Type Co',
      billingType: 'PER_CLEAN',
      cleanerPayType: 'PER_CLEAN',
      paymentRulePreset: 'RESIDENTIAL_STANDARD',
      locations: [{ name: 'Main Home', address: '12 Main St' }],
    }))

    expect(createResponse.status).toBe(201)
    const created = await createResponse.json()
    expect(created.propertyType).toBe('RESIDENTIAL')
    expect(created.paymentRulePreset).toBe('RESIDENTIAL_STANDARD')

    const scheduleResponse = await createSchedule(jsonReq('http://test/api/schedules', 'POST', {
      locationId: created.locations[0].id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([1]),
      startDate: '2026-06-01',
      defaultClientRate: 120,
      defaultSubcontractorRate: 80,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      subcontractorId: null,
      timeType: 'SPECIFIC',
      startTime: '09:00',
    }))

    expect(scheduleResponse.status).toBe(201)
    const schedule = await scheduleResponse.json()
    expect(schedule.paymentCadenceOverride).toBe('RESIDENTIAL_7_DAY')

    const dataResponse = await getClientsData()
    expect(dataResponse.status).toBe(200)
    const dataClients = await dataResponse.json()
    expect(dataClients.find((client: { id: string; propertyType: string | null }) => client.id === created.id)?.propertyType).toBe('RESIDENTIAL')

    const updateResponse = await updateClient(
      jsonReq(`http://test/api/clients/${created.id}`, 'PUT', {
        name: 'Property Type Co',
        billingType: 'PER_CLEAN',
        cleanerPayType: 'PER_CLEAN',
        paymentRulePreset: 'COMMERCIAL_STANDARD',
      }),
      { params: { id: created.id } },
    )

    expect(updateResponse.status).toBe(200)
    const updated = await updateResponse.json()
    expect(updated.propertyType).toBe('COMMERCIAL')
    expect(updated.paymentRulePreset).toBe('COMMERCIAL_STANDARD')

    const updatedSchedule = await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } })
    expect(updatedSchedule.paymentCadenceOverride).toBe('COMMERCIAL_CLIENT_PAID_OR_7TH')

    const tableResponse = await getTableData()
    expect(tableResponse.status).toBe(200)
    const tableData = await tableResponse.json()
    const tableRow = tableData.rows.find((row: { id: string }) => row.id === created.id)
    expect(tableRow?.propertyType).toBe('COMMERCIAL')
    expect(tableRow?.paymentRulePreset).toBe('COMMERCIAL_STANDARD')
  })
})
