import { describe, it, expect } from 'vitest'
import { isJobPayable } from '@/lib/payment-cadence'

const NOW = new Date('2026-06-01T12:00:00Z')

function job(over: Record<string, any> = {}) {
  return {
    id: 'j',
    date: new Date('2026-05-10T12:00:00Z'),
    scheduleId: 's1',
    invoiced: false,
    subcontractorPaid: false,
    location: { client: { id: 'C1' } },
    invoiceLineItems: [] as any[],
    ...over,
  }
}

const sub = (over: Record<string, any> = {}) => ({
  paymentCadence: 'IMMEDIATE',
  excludeClientIds: null,
  ...over,
})

describe('payment timing - basic guards', () => {
  it('a past clean is payable immediately; a future clean is not', () => {
    expect(isJobPayable(job(), sub(), null, NOW)).toBe(true)
    expect(isJobPayable(job({ date: new Date('2026-07-01T12:00:00Z') }), sub(), null, NOW)).toBe(false)
  })

  it('an already-paid clean is never payable again', () => {
    expect(isJobPayable(job({ subcontractorPaid: true }), sub(), null, NOW)).toBe(false)
  })

  it('an excluded client is never payable', () => {
    expect(isJobPayable(job(), sub({ excludeClientIds: JSON.stringify(['C1']) }), null, NOW)).toBe(false)
  })
})

describe('payment timing - after the client pays', () => {
  const afterClientPays = sub({ paymentCadence: 'AFTER_CLIENT_PAYS' })

  it('not payable until the linked invoice is actually PAID', () => {
    const sent = job({ invoiced: true, invoiceLineItems: [{ invoice: { status: 'SENT' } }] })
    const paid = job({ invoiced: true, invoiceLineItems: [{ invoice: { status: 'PAID' } }] })
    expect(isJobPayable(sent, afterClientPays, null, NOW)).toBe(false)
    expect(isJobPayable(paid, afterClientPays, null, NOW)).toBe(true)
  })
})

describe('payment timing - end of month and schedule override', () => {
  it('END_OF_MONTH only becomes payable after the clean month ends', () => {
    const eom = sub({ paymentCadence: 'END_OF_MONTH' })
    expect(isJobPayable(job(), eom, null, NOW)).toBe(true)
    const midMay = new Date('2026-05-20T12:00:00Z')
    expect(isJobPayable(job(), eom, null, midMay)).toBe(false)
  })

  it('a schedule-level cadence override wins over the cleaner default', () => {
    const override = { paymentCadenceOverride: 'ON_CLEANER_INVOICE' }
    expect(isJobPayable(job(), sub(), override, NOW)).toBe(false)
  })
})

describe('payment timing - residential and commercial payout rules', () => {
  it('residential 7-day work waits 7 days after service', () => {
    const residential = sub({ paymentCadence: 'RESIDENTIAL_7_DAY' })
    expect(isJobPayable(job({ date: new Date('2026-05-26T12:00:00Z') }), residential, null, NOW)).toBe(false)
    expect(isJobPayable(job({ date: new Date('2026-05-24T12:00:00Z') }), residential, null, NOW)).toBe(true)
  })

  it('fast-pay releases residential work after 72 hours', () => {
    const residentialFastPay = sub({ paymentCadence: 'RESIDENTIAL_7_DAY', fastPay: true })
    expect(isJobPayable(job({ date: new Date('2026-05-30T12:00:00Z') }), residentialFastPay, null, NOW)).toBe(false)
    expect(isJobPayable(job({ date: new Date('2026-05-29T12:00:00Z') }), residentialFastPay, null, NOW)).toBe(true)
  })

  it('commercial paid-or-7th work becomes payable when the client pays', () => {
    const commercial = sub({ paymentCadence: 'COMMERCIAL_CLIENT_PAID_OR_7TH' })
    const unpaidInvoice = job({
      date: new Date('2026-05-20T12:00:00Z'),
      invoiced: true,
      invoiceLineItems: [{ invoice: { status: 'SENT' } }],
    })
    const paidInvoice = job({
      date: new Date('2026-05-20T12:00:00Z'),
      invoiced: true,
      invoiceLineItems: [{ invoice: { status: 'PAID' } }],
    })
    expect(isJobPayable(unpaidInvoice, commercial, null, NOW)).toBe(false)
    expect(isJobPayable(paidInvoice, commercial, null, NOW)).toBe(true)
  })

  it('commercial paid-or-7th work falls back to the 7th of the next month', () => {
    const commercial = sub({ paymentCadence: 'COMMERCIAL_CLIENT_PAID_OR_7TH' })
    const unpaid = job({ date: new Date('2026-05-20T12:00:00Z') })
    expect(isJobPayable(unpaid, commercial, null, new Date('2026-06-06T12:00:00Z'))).toBe(false)
    expect(isJobPayable(unpaid, commercial, null, new Date('2026-06-07T12:00:00Z'))).toBe(true)
  })
})
