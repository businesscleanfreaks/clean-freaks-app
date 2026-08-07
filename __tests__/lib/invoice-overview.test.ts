import { describe, expect, it } from 'vitest'
import {
  computeOverviewMetrics,
  monthBounds,
  isValidPeriod,
  currentPeriod,
  type OverviewInvoice,
} from '@/lib/invoice-overview'

const NOW = new Date('2026-07-20T12:00:00Z')

const inv = (over: Partial<OverviewInvoice> & { id: string }): OverviewInvoice => ({
  invoiceNumber: `INV-${over.id}`,
  clientName: 'Client',
  status: 'DRAFT',
  totalAmount: 100,
  dateCreated: '2026-07-01T12:00:00Z',
  dateDue: null,
  datePaid: null,
  ...over,
})

describe('computeOverviewMetrics', () => {
  it('sums collected, expected and outstanding correctly', () => {
    const m = computeOverviewMetrics([
      inv({ id: '1', status: 'PAID', totalAmount: 300 }),
      inv({ id: '2', status: 'SENT', totalAmount: 200, dateDue: '2026-08-01T12:00:00Z' }),
      inv({ id: '3', status: 'DRAFT', totalAmount: 500 }),
    ], NOW)

    expect(m.collected).toBe(300)
    expect(m.expected).toBe(1000)
    // Drafts are excluded — the client has not been asked to pay them.
    expect(m.outstanding).toBe(200)
    expect(m.collectedPct).toBe(30)
  })

  it('excludes VOID invoices from every total', () => {
    const m = computeOverviewMetrics([
      inv({ id: '1', status: 'PAID', totalAmount: 100 }),
      inv({ id: '2', status: 'VOID', totalAmount: 9999 }),
    ], NOW)

    expect(m.expected).toBe(100)
    expect(m.collected).toBe(100)
    expect(m.invoiceCount).toBe(1)
    expect(m.collectedPct).toBe(100)
  })

  it('flags only SENT invoices past their due date as overdue', () => {
    const m = computeOverviewMetrics([
      inv({ id: 'late', status: 'SENT', totalAmount: 150, dateDue: '2026-07-10T12:00:00Z' }),
      inv({ id: 'future', status: 'SENT', totalAmount: 80, dateDue: '2026-08-10T12:00:00Z' }),
      // A draft past its date is NOT overdue — it was never sent.
      inv({ id: 'draft', status: 'DRAFT', totalAmount: 999, dateDue: '2026-01-01T12:00:00Z' }),
      // Paid invoices are never overdue.
      inv({ id: 'paid', status: 'PAID', totalAmount: 999, dateDue: '2026-01-01T12:00:00Z' }),
    ], NOW)

    expect(m.overdue.map(o => o.id)).toEqual(['late'])
    expect(m.overdue[0].daysOverdue).toBe(10)
    expect(m.overdueTotal).toBe(150)
  })

  it('sorts overdue with the most overdue first', () => {
    const m = computeOverviewMetrics([
      inv({ id: 'a', status: 'SENT', dateDue: '2026-07-18T12:00:00Z' }),
      inv({ id: 'b', status: 'SENT', dateDue: '2026-06-20T12:00:00Z' }),
    ], NOW)
    expect(m.overdue.map(o => o.id)).toEqual(['b', 'a'])
  })

  it('returns zeroed percentages for an empty month rather than dividing by zero', () => {
    const m = computeOverviewMetrics([], NOW)
    expect(m).toMatchObject({ collected: 0, expected: 0, outstanding: 0, collectedPct: 0, sentPct: 0, invoiceCount: 0 })
    expect(m.overdue).toEqual([])
  })
})

describe('period helpers', () => {
  it('produces inclusive month bounds', () => {
    const { start, end } = monthBounds('2026-02')
    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    // 2026 is not a leap year — February ends on the 28th.
    expect(end.toISOString()).toBe('2026-02-28T23:59:59.999Z')
  })

  it('handles December without rolling the year incorrectly', () => {
    const { start, end } = monthBounds('2026-12')
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-12-31T23:59:59.999Z')
  })

  it('validates period strings', () => {
    expect(isValidPeriod('2026-07')).toBe(true)
    expect(isValidPeriod('2026-13')).toBe(false)
    expect(isValidPeriod('2026-00')).toBe(false)
    expect(isValidPeriod('July')).toBe(false)
    expect(isValidPeriod(null)).toBe(false)
  })

  it('zero-pads the current period', () => {
    expect(currentPeriod(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03')
  })
})
