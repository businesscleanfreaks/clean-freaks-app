import { describe, expect, it } from 'vitest'
import {
  toLedgerRow,
  deriveKind,
  sortRows,
  filterByTab,
  tabCounts,
  computeStats,
  type LedgerSource,
} from '@/lib/invoice-ledger'

const NOW = new Date('2026-07-20T12:00:00Z')

const src = (over: Partial<LedgerSource> & { id: string }): LedgerSource => ({
  invoiceNumber: `INV-${over.id}`,
  clientName: 'Client',
  status: 'DRAFT',
  totalAmount: 100,
  dateDue: null,
  datePaid: null,
  scheduledSendAt: null,
  billingType: 'PER_CLEAN',
  isOneOff: false,
  paymentMethod: null,
  paymentReference: null,
  clearingSince: null,
  trackOnly: false,
  ...over,
})

const row = (over: Partial<LedgerSource> & { id: string }) => toLedgerRow(src(over), NOW)

describe('ledger status derivation', () => {
  it('maps a plain draft to "To send"', () => {
    expect(row({ id: '1', status: 'DRAFT' }).ledgerStatus).toBe('To send')
  })

  it('maps a draft with a scheduled send to "Scheduled", not "To send"', () => {
    const r = row({ id: '1', status: 'DRAFT', scheduledSendAt: '2026-08-14T12:00:00Z' })
    expect(r.ledgerStatus).toBe('Scheduled')
    expect(r.subtext).toBe('Scheduled to send on Aug 14')
  })

  it('separates sent invoices into unpaid vs payment late by due date', () => {
    expect(row({ id: '1', status: 'SENT', dateDue: '2026-08-01T12:00:00Z' }).ledgerStatus).toBe('Sent: Unpaid')
    const late = row({ id: '2', status: 'SENT', dateDue: '2026-07-10T12:00:00Z' })
    expect(late.ledgerStatus).toBe('Payment late')
    expect(late.daysLate).toBe(10)
  })

  it('treats paid as "Sent: Paid" even when the due date has passed', () => {
    const r = row({ id: '1', status: 'PAID', dateDue: '2026-01-01T12:00:00Z' })
    expect(r.ledgerStatus).toBe('Sent: Paid')
    expect(r.daysLate).toBe(0)
  })

  it('builds the paid-via subtext with · separators and no em dash', () => {
    const r = row({ id: '1', status: 'PAID', paymentMethod: 'ZELLE', paymentReference: 'GEORGIA LAWRENCE' })
    expect(r.subtext).toBe('Paid via Zelle · from “GEORGIA LAWRENCE”')
    expect(r.subtext).not.toMatch(/—/)
  })

  it('flags a draft due today or earlier as urgent, but never a sent one', () => {
    expect(row({ id: '1', status: 'DRAFT', dateDue: '2026-07-19T12:00:00Z' }).urgent).toBe(true)
    expect(row({ id: '2', status: 'DRAFT', dateDue: '2026-08-19T12:00:00Z' }).urgent).toBe(false)
    expect(row({ id: '3', status: 'SENT', dateDue: '2026-07-01T12:00:00Z' }).urgent).toBe(false)
  })
})

describe('clearing (a sub-state of Sent: Unpaid, never its own tab)', () => {
  it('keeps the row filed under Sent: Unpaid but relabels the pill', () => {
    const r = row({
      id: '1', status: 'SENT', dateDue: '2026-08-01T12:00:00Z', clearingSince: '2026-07-18T12:00:00Z',
    })
    expect(r.ledgerStatus).toBe('Sent: Unpaid')
    expect(r.clearing).toBe(true)
    // 18 Jul + 7 days
    expect(r.statusLabel).toBe('Clearing ~Jul 25')
  })

  it('still applies to a late invoice without hiding that it is late', () => {
    const r = row({ id: '1', status: 'SENT', dateDue: '2026-07-01T12:00:00Z', clearingSince: '2026-07-19T12:00:00Z' })
    expect(r.ledgerStatus).toBe('Payment late')
    expect(r.clearing).toBe(true)
    expect(r.daysLate).toBe(19)
  })

  it('never shows clearing on a paid invoice, even if the flag lingers', () => {
    const r = row({ id: '1', status: 'PAID', clearingSince: '2026-07-18T12:00:00Z' })
    expect(r.clearing).toBe(false)
    expect(r.statusLabel).toBe('Sent: Paid')
  })

  it('never shows clearing on a draft', () => {
    expect(row({ id: '1', status: 'DRAFT', clearingSince: '2026-07-18T12:00:00Z' }).clearing).toBe(false)
  })
})

describe('track only', () => {
  it('explains that no invoice is emailed', () => {
    expect(row({ id: '1', status: 'DRAFT', trackOnly: true }).subtext).toBe('Track only · client pays on their own')
  })

  it('does not override the paid-via line once the money is in', () => {
    const r = row({ id: '1', status: 'PAID', trackOnly: true, paymentMethod: 'ZELLE' })
    expect(r.subtext).toBe('Paid via Zelle')
  })
})

describe('deriveKind', () => {
  it('reads the type pill from billing type, and one-offs from a missing period', () => {
    expect(deriveKind(src({ id: '1', billingType: 'FLAT_RATE' }))).toBe('Flat rate')
    expect(deriveKind(src({ id: '2', billingType: 'PER_CLEAN' }))).toBe('Per clean')
    expect(deriveKind(src({ id: '3', billingType: 'FLAT_RATE', isOneOff: true }))).toBe('One-off')
  })
})

describe('sorting, tabs and counts', () => {
  const rows = [
    row({ id: '1', clientName: 'Zed Cleaning', status: 'PAID' }),
    row({ id: '2', clientName: 'Acme Corp', status: 'DRAFT' }),
    row({ id: '3', clientName: 'Modern Animal', status: 'SENT', dateDue: '2026-07-01T12:00:00Z' }),
  ]

  it('opens sorted alphabetically by client', () => {
    expect(sortRows(rows).map(r => r.clientName)).toEqual(['Acme Corp', 'Modern Animal', 'Zed Cleaning'])
  })

  it('filters by tab and counts every status', () => {
    expect(filterByTab(rows, 'All')).toHaveLength(3)
    expect(filterByTab(rows, 'To send').map(r => r.clientName)).toEqual(['Acme Corp'])
    const counts = tabCounts(rows)
    expect(counts).toMatchObject({ All: 3, 'To send': 1, 'Payment late': 1, 'Sent: Paid': 1, Scheduled: 0 })
  })
})

describe('computeStats', () => {
  it('splits collected, outstanding and late, and names the worst offender', () => {
    const rows = [
      row({ id: '1', clientName: 'Paid Co', status: 'PAID', totalAmount: 300 }),
      row({ id: '2', clientName: 'Waiting Co', status: 'SENT', totalAmount: 200, dateDue: '2026-08-01T12:00:00Z' }),
      row({ id: '3', clientName: 'Late A', status: 'SENT', totalAmount: 150, dateDue: '2026-07-12T12:00:00Z' }),
      row({ id: '4', clientName: 'Late B', status: 'SENT', totalAmount: 50, dateDue: '2026-07-01T12:00:00Z' }),
      row({ id: '5', clientName: 'Draft Co', status: 'DRAFT', totalAmount: 999 }),
    ]
    const s = computeStats(rows)
    expect(s.collected).toBe(300)
    expect(s.billed).toBe(1699)
    // Outstanding counts sent-but-unpaid AND late; drafts are excluded.
    expect(s.outstanding).toBe(400)
    expect(s.unpaidCount).toBe(3)
    expect(s.lateTotal).toBe(200)
    expect(s.lateClientCount).toBe(2)
    // Most days late wins, not the largest amount.
    expect(s.worstOffender).toMatchObject({ clientName: 'Late B', daysLate: 19 })
  })

  it('reports no worst offender when nobody is late', () => {
    expect(computeStats([row({ id: '1', status: 'PAID' })]).worstOffender).toBeNull()
  })
})
