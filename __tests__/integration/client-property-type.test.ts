import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createClient } from '@/app/api/clients/route'
import { PUT as updateClient } from '@/app/api/clients/[id]/route'
import { GET as getClientsData } from '@/app/api/clients/data/route'
import { GET as getTableData } from '@/app/api/clients/table-data/route'

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
  it('round-trips residential/commercial type through create, update, list, and table data routes', async () => {
    const createResponse = await createClient(jsonReq('http://test/api/clients', 'POST', {
      name: 'Property Type Co',
      billingType: 'PER_CLEAN',
      cleanerPayType: 'PER_CLEAN',
      propertyType: 'RESIDENTIAL',
      locations: [{ name: 'Main Home', address: '12 Main St' }],
    }))

    expect(createResponse.status).toBe(201)
    const created = await createResponse.json()
    expect(created.propertyType).toBe('RESIDENTIAL')

    const dataResponse = await getClientsData()
    expect(dataResponse.status).toBe(200)
    const dataClients = await dataResponse.json()
    expect(dataClients.find((client: { id: string; propertyType: string | null }) => client.id === created.id)?.propertyType).toBe('RESIDENTIAL')

    const updateResponse = await updateClient(
      jsonReq(`http://test/api/clients/${created.id}`, 'PUT', {
        name: 'Property Type Co',
        billingType: 'PER_CLEAN',
        cleanerPayType: 'PER_CLEAN',
        propertyType: 'COMMERCIAL',
      }),
      { params: { id: created.id } },
    )

    expect(updateResponse.status).toBe(200)
    const updated = await updateResponse.json()
    expect(updated.propertyType).toBe('COMMERCIAL')

    const tableResponse = await getTableData()
    expect(tableResponse.status).toBe(200)
    const tableData = await tableResponse.json()
    expect(tableData.rows.find((row: { id: string; propertyType: string | null }) => row.id === created.id)?.propertyType).toBe('COMMERCIAL')
  })
})
