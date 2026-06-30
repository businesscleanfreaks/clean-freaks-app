import { describe, it, expect } from 'vitest'
import { checkInvoiceAgainstSchedule } from '@/lib/invoice-guard'

const job = (over: Partial<{ iso: string; status: string; onThisInvoice: boolean; invoicedElsewhere: boolean; hasCancellationFee: boolean }> = {}) => ({
  iso: '2026-05-04',
  status: 'COMPLETED',
  onThisInvoice: true,
  invoicedElsewhere: false,
  ...over,
})

describe('pre-invoice guard', () => {
  it('passes when every billed clean is valid and nothing is missing (per-clean)', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [job({ iso: '2026-05-04' }), job({ iso: '2026-05-11' })],
    })
    expect(res.matches).toBe(true)
    expect(res.findings).toHaveLength(0)
  })

  it('flags a billed clean that was since cancelled', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [job({ status: 'CANCELLED', onThisInvoice: true })],
    })
    expect(res.matches).toBe(false)
    expect(res.findings.map((f) => f.code)).toContain('BILLED_BUT_CANCELLED')
  })

  it('flags a clean in the period that this invoice misses (per-clean under-billing)', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [
        job({ iso: '2026-05-04', onThisInvoice: true }),
        job({ iso: '2026-05-11', onThisInvoice: false }), // missing
      ],
    })
    expect(res.matches).toBe(false)
    expect(res.findings.map((f) => f.code)).toContain('MISSING_CLEAN')
  })

  it('does not flag a missing clean already billed on another invoice', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [job({ onThisInvoice: false, invoicedElsewhere: true })],
    })
    expect(res.matches).toBe(true)
  })

  it('flat-rate ignores individual missing cleans (one monthly line)', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'FLAT_RATE',
      periodJobs: [job({ onThisInvoice: false, invoicedElsewhere: false })],
    })
    expect(res.matches).toBe(true)
  })

  it('flat-rate still flags billing a cancelled clean', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'FLAT_RATE',
      periodJobs: [job({ status: 'CANCELLED', onThisInvoice: true })],
    })
    expect(res.matches).toBe(false)
    expect(res.findings.map((f) => f.code)).toContain('BILLED_BUT_CANCELLED')
  })

  it('does NOT flag a cancelled clean billed as a cancellation fee', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [job({ status: 'CANCELLED', onThisInvoice: true, hasCancellationFee: true })],
    })
    expect(res.matches).toBe(true)
    expect(res.findings).toHaveLength(0)
  })

  it('still flags a cancelled clean billed WITHOUT a cancellation fee', () => {
    const res = checkInvoiceAgainstSchedule({
      billingType: 'PER_CLEAN',
      periodJobs: [job({ status: 'CANCELLED', onThisInvoice: true, hasCancellationFee: false })],
    })
    expect(res.matches).toBe(false)
    expect(res.findings.map((f) => f.code)).toContain('BILLED_BUT_CANCELLED')
  })
})
