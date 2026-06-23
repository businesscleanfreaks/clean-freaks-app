import { describe, it, expect } from 'vitest'
import { isJobPayable } from '@/lib/payment-cadence'

const NOW = new Date('2026-06-01T12:00:00Z')

function job(over: Record<string, any> = {}) {
  return {
    id: 'j',
    date: new Date('2026-05-10T12:00:00Z'), // last month, so it's in the past relative to NOW
    scheduleId: 's1',
    invoiced: false,
    subcontractorPaid: false,
    location: { client: { id: 'C1' } },
    invoiceLineItems: [] as any[],
    ...over,
  }
}
const sub = (over: Record<string, any> = {}) => ({ paymentCadence: 'IMMEDIATE', excludeClientIds: null, ...over })

describe('payment timing — basic guards', () => {
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

describe('payment timing — "after the client pays"', () => {
  const afterClientPays = sub({ paymentCadence: 'AFTER_CLIENT_PAYS' })

  it('not payable until the linked invoice is actually PAID', () => {
    const sent = job({ invoiced: true, invoiceLineItems: [{ invoice: { status: 'SENT' } }] })
    const paid = job({ invoiced: true, invoiceLineItems: [{ invoice: { status: 'PAID' } }] })
    expect(isJobPayable(sent, afterClientPays, null, NOW)).toBe(false)
    expect(isJobPayable(paid, afterClientPays, null, NOW)).toBe(true)
  })
})

describe('payment timing — end of month + schedule override', () => {
  it('END_OF_MONTH only becomes payable after the clean\'s month ends', () => {
    const eom = sub({ paymentCadence: 'END_OF_MONTH' })
    expect(isJobPayable(job(), eom, null, NOW)).toBe(true) // May clean, now June → month ended
    const midMay = new Date('2026-05-20T12:00:00Z')
    expect(isJobPayable(job(), eom, null, midMay)).toBe(false) // still inside May
  })

  it('a schedule-level cadence override wins over the cleaner default', () => {
    // Cleaner default is IMMEDIATE, but the schedule says "only on cleaner invoice" → not auto-payable
    const override = { paymentCadenceOverride: 'ON_CLEANER_INVOICE' }
    expect(isJobPayable(job(), sub(), override, NOW)).toBe(false)
  })
})
