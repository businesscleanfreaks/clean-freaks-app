import { describe, it, expect } from 'vitest'
import { parseZelleNotification } from '@/lib/zelle-parse'

// These mirror the REAL Chase Zelle email structure but use invented names,
// amounts, and transaction numbers — no real customer payment data in the repo.
function chase(opts: { name: string; amount: string; txn?: string; memo?: string }): string {
  return [
    `${opts.name} sent you money`,
    '',
    'Here are the details:',
    '',
    `Amount $${opts.amount}`,
    'Sent on Jun 29, 2026',
    `Transaction number ${opts.txn ?? '10000001'}`,
    `Memo ${opts.memo ?? 'N/A'}`,
    '',
    `${opts.name} is registered with a Zelle® member bank that supports payments in real time.`,
  ].join('\n')
}

describe('parseZelleNotification — Chase format', () => {
  it('parses payer, amount, transaction number and memo', () => {
    const r = parseZelleNotification(null, chase({
      name: 'ACME WIDGETS LLC', amount: '950.00', txn: '20000001', memo: 'INVOICE 12345 OFFICE CLEANING',
    }))
    expect(r).not.toBeNull()
    expect(r!.senderName).toBe('ACME WIDGETS LLC')
    expect(r!.amount).toBe(950)
    expect(r!.confirmationNumber).toBe('20000001')
    expect(r!.memo).toBe('INVOICE 12345 OFFICE CLEANING')
    expect(r!.sentAt?.getUTCFullYear()).toBe(2026)
  })

  it('handles a comma in the amount', () => {
    const r = parseZelleNotification(null, chase({ name: 'BRIGHTLEAF STUDIOS', amount: '1,104.00' }))
    expect(r!.amount).toBe(1104)
  })

  it('keeps a company name with a comma + suffix intact', () => {
    const r = parseZelleNotification(null, chase({ name: 'RIVERSIDE DANCE ACADEMY, LLC', amount: '569.00' }))
    expect(r!.senderName).toBe('RIVERSIDE DANCE ACADEMY, LLC')
  })

  it('treats a Memo of "N/A" as no memo', () => {
    const r = parseZelleNotification(null, chase({ name: 'JANE DOE', amount: '349.00', memo: 'N/A' }))
    expect(r!.memo).toBeNull()
    expect(r!.senderName).toBe('JANE DOE')
  })

  it('parses a single-word payer', () => {
    const r = parseZelleNotification(null, chase({ name: 'QORVEX', amount: '165.00' }))
    expect(r!.senderName).toBe('QORVEX')
    expect(r!.amount).toBe(165)
  })

  it('still parses the alternate "You received $X from NAME" format', () => {
    const r = parseZelleNotification('You received $400.00 from NORTHGATE BUILDERS via Zelle', 'Zelle payment received.')
    expect(r!.senderName).toBe('NORTHGATE BUILDERS')
    expect(r!.amount).toBe(400)
  })

  it('returns null for a non-payment email', () => {
    expect(parseZelleNotification('Re: schedule', 'Can we move tomorrow’s clean to Friday?')).toBeNull()
  })
})
